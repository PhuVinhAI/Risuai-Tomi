import { downloadFile, forageStorage } from '../globalApi.svelte'
import {
    getDirectorWriterSettings,
    type DirectorAttemptTrace,
    type WritingStyleBase,
} from './directorWriter'

const LOG_KEY = 'directorWriter/log.jsonl'
const MAX_ENTRIES = 2000

export interface DirectorWriterLogEntry {
    time: string
    chatId: string
    messageId: string
    /** Which path produced this turn. */
    path: 'fresh' | 'reroll-writer' | 'continue'
    /** Why the Director ran, or why it did not. */
    reason: string
    historyHashMatched: boolean
    /** Which text supplies the prose-style baseline for this packet. */
    styleBase?: WritingStyleBase
    director?: {
        preset: string
        model: string
        /** Input prompt is NOT stored verbatim: it is the whole context, hundreds of KB per turn. */
        promptTokens: number
        promptHash: string
        packetChars: number
        durationMs: number
        packet: string
        /** Raw and normalized model output for retries or failed Director runs. */
        attempts?: DirectorAttemptTrace[]
    }
    writer?: {
        preset: string
        model: string
    }
    validation?: {
        ok: boolean
        found: string[]
        missing: string[]
        attempts: number
    }
    /** Lets you split the log by "before/after I edited the Director prompt". */
    directorPromptHash?: string
    schemaHash?: string
    error?: string
}

let entries: DirectorWriterLogEntry[] = []
let loaded = false
let writeChain: Promise<void> = Promise.resolve()

function serialize(): string {
    return entries.map((entry) => JSON.stringify(entry)).join('\n')
}

async function loadLog(): Promise<void> {
    if (loaded) {
        return
    }
    loaded = true
    try {
        const raw = await forageStorage.getItem(LOG_KEY)
        if (!raw) {
            return
        }
        const text = new TextDecoder().decode(new Uint8Array(raw))
        entries = text.split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => {
                try {
                    return JSON.parse(line) as DirectorWriterLogEntry
                }
                catch {
                    return null
                }
            })
            .filter((entry): entry is DirectorWriterLogEntry => entry !== null)
    }
    catch (error) {
        console.error('directorWriter: could not load log', error)
    }
}

function persist(): void {
    writeChain = writeChain.then(async () => {
        try {
            await forageStorage.setItem(LOG_KEY, new TextEncoder().encode(serialize()))
        }
        catch (error) {
            console.error('directorWriter: could not persist log', error)
        }
    })
}

/** No-op unless logging is switched on. Never throws into the generation path. */
export async function appendDirectorWriterLog(entry: DirectorWriterLogEntry): Promise<void> {
    try {
        if (!getDirectorWriterSettings().logEnabled) {
            return
        }
        await loadLog()
        entries.push(entry)
        while (entries.length > MAX_ENTRIES) {
            entries.shift()
        }
        persist()
    }
    catch (error) {
        console.error('directorWriter: could not append log', error)
    }
}

export async function getDirectorWriterLogStats(): Promise<{ count: number, bytes: number }> {
    await loadLog()
    return {
        count: entries.length,
        bytes: new TextEncoder().encode(serialize()).byteLength,
    }
}

export async function downloadDirectorWriterLog(): Promise<boolean> {
    await loadLog()
    if (entries.length === 0) {
        return false
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await downloadFile(`director-writer-log-${stamp}.jsonl`, serialize())
    return true
}

export async function clearDirectorWriterLog(): Promise<void> {
    await loadLog()
    entries = []
    try {
        await forageStorage.removeItem(LOG_KEY)
    }
    catch (error) {
        console.error('directorWriter: could not clear log', error)
    }
}
