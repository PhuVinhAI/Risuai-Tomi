import { downloadFile, forageStorage } from '../globalApi.svelte'
import { getPackerWriterSettings, type PackerAttemptTrace } from './packerWriter'

const LOG_KEY = 'packerWriter/log.jsonl'
const MAX_ENTRIES = 2000

export interface PackerWriterLogEntry {
    time: string
    chatId: string
    messageId: string
    path: 'direct-writer' | 'fresh' | 'reroll-writer' | 'continue'
    reason: string
    packerActive: boolean
    historyHashMatched: boolean
    packer?: {
        preset: string
        model: string
        promptTokens: number
        promptHash: string
        packetChars: number
        durationMs: number
        packet: string
        attempts?: PackerAttemptTrace[]
    }
    writer?: {
        preset: string
        model: string
    }
    validation?: {
        ok: boolean
        error?: string
        attempts: number
    }
    packerPromptHash?: string
    error?: string
}

let entries: PackerWriterLogEntry[] = []
let loaded = false
let writeChain: Promise<void> = Promise.resolve()

function serialize(): string {
    return entries.map((entry) => JSON.stringify(entry)).join('\n')
}

async function loadLog(): Promise<void> {
    if (loaded) return
    loaded = true
    try {
        const raw = await forageStorage.getItem(LOG_KEY)
        if (!raw) return
        const text = new TextDecoder().decode(new Uint8Array(raw))
        entries = text.split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
                try {
                    return [JSON.parse(line) as PackerWriterLogEntry]
                } catch {
                    return []
                }
            })
    } catch (error) {
        console.error('packerWriter: could not load log', error)
    }
}

function persist(): void {
    writeChain = writeChain.then(async () => {
        try {
            await forageStorage.setItem(LOG_KEY, new TextEncoder().encode(serialize()))
        } catch (error) {
            console.error('packerWriter: could not persist log', error)
        }
    })
}

export async function appendPackerWriterLog(entry: PackerWriterLogEntry): Promise<void> {
    try {
        if (!getPackerWriterSettings().logEnabled) return
        await loadLog()
        entries.push(entry)
        while (entries.length > MAX_ENTRIES) entries.shift()
        persist()
    } catch (error) {
        console.error('packerWriter: could not append log', error)
    }
}

export async function getPackerWriterLogStats(): Promise<{ count: number, bytes: number }> {
    await loadLog()
    return { count: entries.length, bytes: new TextEncoder().encode(serialize()).byteLength }
}

export async function downloadPackerWriterLog(): Promise<boolean> {
    await loadLog()
    if (entries.length === 0) return false
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await downloadFile(`packer-writer-log-${stamp}.jsonl`, serialize())
    return true
}

export async function clearPackerWriterLog(): Promise<void> {
    await loadLog()
    entries = []
    try {
        await forageStorage.removeItem(LOG_KEY)
    } catch (error) {
        console.error('packerWriter: could not clear log', error)
    }
}
