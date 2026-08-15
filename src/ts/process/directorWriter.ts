import type { OpenAIChat } from './index.svelte'
import { getDatabase, type botPreset, type character, type Message } from '../storage/database.svelte'
import { requestChatData } from './request/request'
import { risuChatParser } from './scripts'
import { parseChatML } from '../parser/chatML'
import { prebuiltPresets } from './templates/templates'
import { safeStructuredClone } from '../polyfill'

export interface PacketSchemaRow {
    name: string
    description: string
    required: boolean
}

export type DirectorWriterRole = 'director' | 'writer'

export interface DirectorWriterSettings {
    enabled: boolean
    directorPreset: string
    writerPreset: string
    rerollMode: 'writer' | 'both'
    logEnabled: boolean
    packetCacheSize: number
}

export const defaultDirectorWriterSettings: DirectorWriterSettings = {
    enabled: false,
    directorPreset: '',
    writerPreset: '',
    rerollMode: 'writer',
    logEnabled: false,
    packetCacheSize: 40,
}

export function defaultPacketSchema(): PacketSchemaRow[] {
    return [
        { name: 'SITUATION', required: true, description: 'Where and when the scene is, who is present, positions, physical and clothing state. Copy exact details, do not paraphrase.' },
        { name: 'FACTS', required: true, description: 'Things that already happened, taken from the history and the lore. Only what this turn needs. Preserve names and verbatim quotes in their original language.' },
        { name: 'CHARACTER', required: true, description: 'Traits that are active right now, current emotion, current goal, attitude toward the user, plus 2-4 voice anchors taken from the character card. Do not rewrite the voice.' },
        { name: 'DIRECTION', required: true, description: 'The dramatic intention for this turn only. State intent, never storyboard individual sentences or lines of dialogue.' },
        { name: 'OUTPUT LANGUAGE', required: true, description: 'The language the writer must write in. Match the language of the latest user message, not the language of this packet.' },
        { name: 'FORBIDDEN', required: false, description: 'What must not happen this turn: never act or speak for the user, threads that must stay unresolved, information that must stay hidden. Leave blank if there is nothing.' },
        { name: 'OMITTED', required: false, description: 'Anything you knowingly left out of this packet, so a reader can tell what is missing. Leave blank if nothing was dropped.' },
        { name: 'LAST TURN NOTES', required: false, description: 'Rule violations in the previous reply only: acting for the user, contradicting an established fact, losing the declared voice, repeating an opening verbatim. Never comment on taste or prose quality. Leave blank when there is nothing wrong.' },
    ]
}

export const defaultDirectorPrompt = `You are the DIRECTOR of a roleplay. You do not roleplay.

Read everything above: the character, the lore, the memory, the full history and the latest user message. Then output a scene packet for a separate writer model that will not see any of that material — only your packet.

Hard rules:
- Do not roleplay. Do not imitate the character. Do not write the reply.
- Do not write dialogue, except when preserving an exact quote is necessary.
- Copy names, verbatim quotes, positions and who-knows-what exactly. These break first when compressed.
- Keep quoted content in its original language. Only your own labels and prose are English.
- Separate fact from direction. Only the DIRECTION section may describe what has not happened yet.
- State intent, not a storyboard. If you script each sentence, the writer only paraphrases you.
- Do not restate the latest user message; the writer receives it separately and verbatim.
- Do not set a word count or response length.

Output nothing but the sections below, in this order, each on its own line as a bracketed header.`

export const defaultWriterPrompt = `You are writing the next roleplay reply.

The scene packet below is your complete working context. Treat every fact in it as canonical.

- Do not invent earlier events that contradict the packet.
- Never act, speak or decide for the user's character.
- Write in the language named by the packet.
- Write only the roleplay reply. No headers, no commentary, no restating the packet.
- Leave the scene open so the user has something to answer.`

function renderSchemaSpec(schema: PacketSchemaRow[]): string {
    const rows = schema.filter((row) => row?.name?.trim())
    if (rows.length === 0) {
        return ''
    }
    const lines = rows.map((row) => {
        const header = `[${row.name.trim().toUpperCase()}]`
        const required = row.required ? '' : ' (optional — leave blank when there is nothing to say)'
        return `${header}${required}\n${row.description?.trim() ?? ''}`
    })
    return `Required output format:\n\n${lines.join('\n\n')}`
}

function bracketName(name: string): string {
    return `[${(name ?? '').trim().toUpperCase()}]`
}

export function getDirectorWriterSettings(): DirectorWriterSettings {
    const db = getDatabase()
    const raw = db.directorWriter
    return {
        enabled: raw?.enabled ?? false,
        directorPreset: raw?.directorPreset ?? '',
        writerPreset: raw?.writerPreset ?? '',
        rerollMode: raw?.rerollMode === 'both' ? 'both' : 'writer',
        logEnabled: raw?.logEnabled ?? false,
        packetCacheSize: raw?.packetCacheSize ?? 40,
    }
}

function getPresetRole(preset: botPreset | null | undefined): DirectorWriterRole | null {
    if (preset?.dwRole === 'director' || preset?.dwRole === 'writer') {
        return preset.dwRole
    }
    return null
}

export function listPresetsByRole(role: DirectorWriterRole): { name: string, index: number }[] {
    const db = getDatabase()
    const out: { name: string, index: number }[] = []
    const presets = db.botPresets ?? []
    for (let i = 0; i < presets.length; i++) {
        if (getPresetRole(presets[i]) === role) {
            out.push({ name: presets[i]?.name ?? `Preset ${i + 1}`, index: i })
        }
    }
    return out
}

function findPresetByName(name: string, role: DirectorWriterRole): botPreset | null {
    if (!name) {
        return null
    }
    const db = getDatabase()
    const found = (db.botPresets ?? []).find((preset) => preset?.name === name)
    if (!found || getPresetRole(found) !== role) {
        return null
    }
    return found
}

export interface DirectorWriterResolved {
    director: botPreset
    writer: botPreset
    settings: DirectorWriterSettings
}

/**
 * Resolves the active Director/Writer pair, or null when the feature is off or
 * misconfigured. Never throws — a broken configuration must fall back to the
 * ordinary single-model path rather than break generation.
 */
export function resolveDirectorWriter(): DirectorWriterResolved | null {
    const settings = getDirectorWriterSettings()
    if (!settings.enabled) {
        return null
    }
    const director = findPresetByName(settings.directorPreset, 'director')
    const writer = findPresetByName(settings.writerPreset, 'writer')
    if (!director || !writer) {
        console.warn('directorWriter: enabled but not resolvable, falling back to single model.', {
            directorPreset: settings.directorPreset,
            directorFound: !!director,
            writerPreset: settings.writerPreset,
            writerFound: !!writer,
        })
        return null
    }
    return { director, writer, settings }
}

/** cyrb53 — small, fast, non-cryptographic. Only used for change detection. */
export function hashString(input: string): string {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Hash of the history the Director actually read: role and raw content of the
 * enabled messages only. Translation caches and regex-processed display text are
 * deliberately excluded so the hash does not change for cosmetic reasons.
 */
export function hashHistoryPrefix(messages: Message[]): string {
    const parts: string[] = []
    for (const message of messages ?? []) {
        if (message?.disabled === 'allBefore') {
            parts.length = 0
            continue
        }
        if (message?.disabled) {
            continue
        }
        parts.push(`${message?.role ?? ''}\u0000${message?.data ?? ''}`)
    }
    return hashString(parts.join('\u0001'))
}

export function getPacketSchema(preset: botPreset): PacketSchemaRow[] {
    const rows = preset?.dwSchema
    if (!Array.isArray(rows) || rows.length === 0) {
        return defaultPacketSchema()
    }
    return rows.filter((row) => row?.name?.trim())
}

export function getRolePrompt(preset: botPreset, role: DirectorWriterRole): string {
    const custom = preset?.dwPrompt?.trim()
    if (custom) {
        return custom
    }
    return role === 'director' ? defaultDirectorPrompt : defaultWriterPrompt
}

/**
 * Identity of a packet. Any change here invalidates a cached packet, which is how
 * "the user edited a message" and "the user swapped presets" both end up forcing a
 * fresh Director run without hooking every mutation path.
 */
export function packetCacheKey(arg: {
    historyHash: string
    directorName: string
    writerName: string
    promptHash: string
    schemaHash: string
    characterId: string
}): string {
    return [
        arg.characterId,
        arg.historyHash,
        arg.directorName,
        arg.writerName,
        arg.promptHash,
        arg.schemaHash,
    ].join('|')
}

interface CachedPacket {
    packet: string
    key: string
}

let packetCache: CachedPacket[] = []

export function getCachedPacket(key: string): string | null {
    const hit = packetCache.find((entry) => entry.key === key)
    return hit ? hit.packet : null
}

export function setCachedPacket(key: string, packet: string, limit: number): void {
    packetCache = packetCache.filter((entry) => entry.key !== key)
    packetCache.push({ key, packet })
    const max = Math.max(1, limit || 1)
    while (packetCache.length > max) {
        packetCache.shift()
    }
}

export interface PacketValidation {
    ok: boolean
    found: string[]
    missing: string[]
}

/**
 * Header counting, never parsing. The case this really guards against is the
 * Director writing prose roleplay instead of a packet, which yields zero headers.
 */
function validatePacket(packet: string, schema: PacketSchemaRow[]): PacketValidation {
    const text = packet ?? ''
    const upper = text.toUpperCase()
    const rows = schema.filter((row) => row?.name?.trim())
    const found: string[] = []
    const missing: string[] = []

    for (const row of rows) {
        const header = bracketName(row.name)
        if (upper.includes(header)) {
            found.push(header)
        }
        else if (row.required) {
            missing.push(header)
        }
    }

    if (missing.length > 0) {
        return { ok: false, found, missing }
    }

    // Floor: when nothing is marked required, still demand at least one header so a
    // prose response cannot pass as a packet.
    const anyRequired = rows.some((row) => row.required)
    if (!anyRequired && found.length === 0) {
        return { ok: false, found, missing: ['(any header)'] }
    }

    return { ok: true, found, missing }
}

function promptRoleToOpenAI(role: 'user' | 'bot' | 'system' | undefined): 'user' | 'assistant' | 'system' {
    if (role === 'user') {
        return 'user'
    }
    if (role === 'bot') {
        return 'assistant'
    }
    return 'system'
}

/**
 * The Writer prompt. History, character card, lorebook and memory are stripped —
 * that is the definition of the Writer role, not an option. Its own role prompt,
 * jailbreak and POV/agency rules are deliberately KEPT: global constraints that live
 * only in the Director stage get dropped, which is the worst documented failure mode
 * of this kind of split.
 */
export function buildWriterFormated(arg: {
    writer: botPreset
    packet: string
    userMessage: OpenAIChat | null
    currentChar?: character
}): OpenAIChat[] {
    const db = getDatabase()
    const out: OpenAIChat[] = []
    const parserArg = { chara: arg.currentChar }

    out.push({ role: 'system', content: getRolePrompt(arg.writer, 'writer') })

    for (const item of arg.writer?.promptTemplate ?? []) {
        if (item.type === 'chatML') {
            const parsed = parseChatML(risuChatParser(item.text ?? '', parserArg))
            if (parsed) {
                out.push(...parsed)
            }
            continue
        }
        if (item.type !== 'plain' && item.type !== 'jailbreak' && item.type !== 'cot') {
            // description / persona / lorebook / memory / authornote / chat /
            // postEverything / cache all carry context. Dropped on purpose.
            continue
        }
        if (item.type === 'jailbreak' && !db.jailbreakToggle) {
            continue
        }
        if (item.type === 'cot' && !db.chainOfThought) {
            continue
        }
        const content = risuChatParser(item.text ?? '', parserArg).trim()
        if (!content) {
            continue
        }
        out.push({ role: promptRoleToOpenAI(item.role), content })
    }

    if ((arg.writer?.promptTemplate ?? []).length === 0) {
        // Legacy preset with no template: fall back to its flat prompt fields.
        for (const text of [arg.writer?.mainPrompt, arg.writer?.jailbreak, arg.writer?.globalNote]) {
            const content = risuChatParser(text ?? '', parserArg).trim()
            if (content) {
                out.push({ role: 'system', content })
            }
        }
    }

    out.push({ role: 'system', content: arg.packet })

    if (arg.userMessage) {
        out.push(arg.userMessage)
    }

    return out
}

/**
 * The Director reads the prompt sendChat already built — the full context with
 * lorebook, memory and history in template order — with its instruction and the
 * packet format appended at the end.
 */
export function buildDirectorFormated(arg: {
    base: OpenAIChat[]
    director: botPreset
    schema: PacketSchemaRow[]
    currentChar?: character
}): OpenAIChat[] {
    const parserArg = { chara: arg.currentChar }
    const instruction = risuChatParser(getRolePrompt(arg.director, 'director'), parserArg)
    const spec = renderSchemaSpec(arg.schema)
    const content = spec ? `${instruction}\n\n${spec}` : instruction
    return [...arg.base, { role: 'system', content }]
}

/**
 * The latest user turn, taken from the already-built prompt so it is processed exactly
 * as Risu would have sent it. Falls back to the raw chat message when the preset
 * systemizes chat roles, and returns null on a turn the user did not speak on — the
 * Director is then expected to open the scene itself.
 */
export function pickLatestUserMessage(formated: OpenAIChat[], messages: Message[]): OpenAIChat | null {
    for (let i = formated.length - 1; i >= 0; i--) {
        if (formated[i]?.role === 'user') {
            return { role: 'user', content: formated[i].content }
        }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.role === 'user' && !message.disabled) {
            return { role: 'user', content: message.data ?? '' }
        }
    }
    return null
}

/**
 * A ready-to-use preset for one side of the pipeline, cloned from a known-good
 * prebuilt so the user does not have to assemble one by hand.
 *
 * The Director keeps the full prompt template because it is the side that needs the
 * card, lorebook, memory and history. The Writer gets a deliberately bare template:
 * its context is stripped at request time anyway, and the two plain items that remain
 * are the global rules that must be restated at the Writer stage rather than trusted
 * to arrive inside the packet.
 */
export function createRolePreset(role: DirectorWriterRole): botPreset {
    const base = safeStructuredClone(prebuiltPresets.OAI2) as unknown as botPreset
    base.dwRole = role
    base.dwPrompt = ''

    if (role === 'director') {
        base.name = 'Director'
        base.temperature = 30
        base.maxResponse = 2000
        base.dwSchema = defaultPacketSchema()
        return base
    }

    base.name = 'Writer'
    base.temperature = 90
    base.dwSchema = undefined
    base.promptTemplate = [
        {
            type: 'plain',
            type2: 'normal',
            role: 'system',
            text: 'Never write, decide or narrate actions for {{user}}. End your reply somewhere {{user}} can respond to.',
        },
    ]
    return base
}

export interface DirectorRunResult {
    ok: boolean
    packet: string
    error?: string
    attempts: number
    validation?: PacketValidation
    model?: string
    durationMs: number
}

/**
 * One Director call, retried once when the output fails validation. A network or API
 * failure is reported as-is and never retried here — requestChatData already owns
 * retries and the per-mode fallback model chain.
 *
 * Only model, temperature and max tokens are taken from the preset. Credentials and
 * endpoints still come from the active provider settings, so a Director on a different
 * provider should be defined as a custom model, which carries its own url and key.
 */
export async function runDirector(arg: {
    formated: OpenAIChat[]
    director: botPreset
    schema: PacketSchemaRow[]
    currentChar?: character
    abortSignal?: AbortSignal
}): Promise<DirectorRunResult> {
    const started = Date.now()
    let attempts = 0
    let lastValidation: PacketValidation | undefined
    let lastModel: string | undefined

    while (attempts < 2) {
        attempts++
        if (arg.abortSignal?.aborted) {
            return { ok: false, packet: '', error: 'Aborted', attempts, durationMs: Date.now() - started }
        }

        const req = await requestChatData({
            formated: arg.formated,
            bias: {},
            useStreaming: false,
            noMultiGen: true,
            currentChar: arg.currentChar,
            staticModel: arg.director?.aiModel || undefined,
            presetOverride: arg.director,
            skipRequestTrigger: true,
        }, 'otherAx', arg.abortSignal)

        lastModel = req.model

        if (req.type !== 'success') {
            const detail = req.type === 'fail' ? req.result : `unexpected response type: ${req.type}`
            return { ok: false, packet: '', error: String(detail), attempts, model: lastModel, durationMs: Date.now() - started }
        }

        const packet = (req.result ?? '').trim()
        lastValidation = validatePacket(packet, arg.schema)
        if (lastValidation.ok) {
            return { ok: true, packet, attempts, validation: lastValidation, model: lastModel, durationMs: Date.now() - started }
        }
    }

    return {
        ok: false,
        packet: '',
        error: `Director output is not a packet. Missing: ${lastValidation?.missing.join(', ') ?? 'unknown'}`,
        attempts,
        validation: lastValidation,
        model: lastModel,
        durationMs: Date.now() - started,
    }
}
