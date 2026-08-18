import { getDatabase, type botPreset, type character } from '../storage/database.svelte'
import { safeStructuredClone } from '../polyfill'
import { prebuiltPresets } from './templates/templates'
import { risuChatParser } from './scripts'
import type { OpenAIChat } from './index.svelte'

export interface ResponseTransformerSettings {
    enabled: boolean
    preset: string
}

export const defaultResponseTransformerSettings: ResponseTransformerSettings = {
    enabled: false,
    preset: '',
}

export const defaultResponseTransformerPrompt = `Rewrite the supplied draft into the final response.

Improve clarity, fluency, pacing, length and language only where needed. Preserve the draft's meaning, facts, character voice, formatting conventions and all existing markup. Do not add, remove or alter image tags or asset keys. Output only the rewritten response without commentary.`

export interface ResolvedResponseTransformer {
    preset: botPreset
    prompt: string
    settings: ResponseTransformerSettings
}

export function getResponseTransformerSettings(): ResponseTransformerSettings {
    const raw = getDatabase().responseTransformer
    return {
        enabled: raw?.enabled ?? false,
        preset: raw?.preset ?? '',
    }
}

export function isTransformerPreset(preset: botPreset | null | undefined): boolean {
    return preset?.transformerEnabled === true && !!preset.transformerPrompt?.trim()
}

export function listTransformerPresets(): { name: string, index: number }[] {
    return (getDatabase().botPresets ?? []).flatMap((preset, index) => isTransformerPreset(preset)
        ? [{ name: preset.name ?? `Preset ${index + 1}`, index }]
        : [])
}

export function resolveResponseTransformer(): ResolvedResponseTransformer | null {
    const settings = getResponseTransformerSettings()
    if (!settings.enabled || !settings.preset) return null

    const preset = (getDatabase().botPresets ?? []).find((candidate) => candidate.name === settings.preset)
    if (!isTransformerPreset(preset)) {
        console.warn('responseTransformer: selected preset is unavailable, disabled, or has no prompt.', {
            preset: settings.preset,
        })
        return null
    }

    return {
        preset,
        prompt: preset.transformerPrompt!.trim(),
        settings,
    }
}

export function stripResponseReasoning(draft: string): string {
    return draft
        .replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, '')
        .replace(/<Thoughts>[\s\S]*$/i, '')
        .trim()
}

export function buildTransformerFormated(arg: {
    transformer: ResolvedResponseTransformer
    draft: string
    currentChar?: character
}): OpenAIChat[] {
    return [
        {
            role: 'system',
            content: risuChatParser(arg.transformer.prompt, { chara: arg.currentChar }),
        },
        {
            role: 'user',
            content: stripResponseReasoning(arg.draft),
        },
    ]
}

export function createTransformerPreset(): botPreset {
    const preset = safeStructuredClone(prebuiltPresets.OAI2) as unknown as botPreset
    preset.name = 'Response Transformer'
    preset.transformerEnabled = true
    preset.transformerPrompt = defaultResponseTransformerPrompt
    preset.temperature = 40
    preset.maxResponse = 2000
    preset.useStreaming = true
    return preset
}
