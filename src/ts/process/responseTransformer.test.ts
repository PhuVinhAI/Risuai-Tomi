import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    db: {
        responseTransformer: { enabled: false, preset: '' },
        botPresets: [],
    } as any,
}))

vi.mock('../storage/database.svelte', () => ({
    getDatabase: () => mocks.db,
}))

vi.mock('../polyfill', () => ({
    safeStructuredClone: <T>(value: T): T => structuredClone(value),
}))

vi.mock('./scripts', () => ({
    risuChatParser: (value: string) => value.replaceAll('{{char}}', 'Miyabi'),
}))

vi.mock('./templates/templates', () => ({
    prebuiltPresets: {
        OAI2: {
            name: 'Base',
            mainPrompt: 'unused',
            jailbreak: 'unused',
            globalNote: '',
            temperature: 80,
            maxContext: 4000,
            maxResponse: 300,
            frequencyPenalty: 0,
            PresensePenalty: 0,
            formatingOrder: [],
            promptPreprocess: false,
            bias: [],
            ooba: {},
            ainconfig: {},
        },
    },
}))

import {
    buildTransformerFormated,
    createTransformerPreset,
    listTransformerPresets,
    resolveResponseTransformer,
    stripResponseReasoning,
} from './responseTransformer'

describe('Response Transformer', () => {
    beforeEach(() => {
        mocks.db.responseTransformer = { enabled: false, preset: '' }
        mocks.db.botPresets = []
    })

    it('sends exactly the Transformer system prompt and visible draft', () => {
        const formated = buildTransformerFormated({
            transformer: {
                settings: { enabled: true, preset: 'Polisher' },
                preset: { name: 'Polisher' } as any,
                prompt: 'Rewrite as {{char}}.',
            },
            draft: '<Thoughts>private reasoning</Thoughts>\nFinal draft.',
        })

        expect(formated).toEqual([
            { role: 'system', content: 'Rewrite as Miyabi.' },
            { role: 'user', content: 'Final draft.' },
        ])
    })

    it('does not resolve disabled presets or presets without a prompt', () => {
        mocks.db.responseTransformer = { enabled: true, preset: 'Polisher' }
        mocks.db.botPresets = [
            { name: 'Polisher', transformerEnabled: true, transformerPrompt: '' },
        ]

        expect(resolveResponseTransformer()).toBeNull()
        expect(listTransformerPresets()).toEqual([])
    })

    it('resolves only the selected enabled preset with a prompt', () => {
        mocks.db.responseTransformer = { enabled: true, preset: 'Polisher' }
        mocks.db.botPresets = [
            { name: 'Other', transformerEnabled: true, transformerPrompt: 'Other prompt' },
            { name: 'Polisher', transformerEnabled: true, transformerPrompt: '  Polish it.  ' },
        ]

        expect(resolveResponseTransformer()?.prompt).toBe('Polish it.')
        expect(listTransformerPresets().map((item) => item.name)).toEqual(['Other', 'Polisher'])
    })

    it('creates a ready-to-use Transformer preset with natural streaming configuration', () => {
        const preset = createTransformerPreset()

        expect(preset.transformerEnabled).toBe(true)
        expect(preset.transformerPrompt?.length).toBeGreaterThan(0)
        expect(preset.useStreaming).toBe(true)
    })

    it('removes every completed reasoning block from the draft', () => {
        expect(stripResponseReasoning('<Thoughts>a</Thoughts>Hello<Thoughts>b</Thoughts> world'))
            .toBe('Hello world')
        expect(stripResponseReasoning('<Thoughts>unfinished reasoning'))
            .toBe('')
    })
})
