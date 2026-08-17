import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    db: {
        jailbreakToggle: true,
        chainOfThought: true,
        packerWriter: undefined,
        botPresets: [],
    },
    requestChatData: vi.fn(),
}))

vi.mock('../storage/database.svelte', () => ({ getDatabase: () => mocks.db }))
vi.mock('./request/request', () => ({ requestChatData: mocks.requestChatData }))
vi.mock('./scripts', () => ({ risuChatParser: (value: string) => value }))
vi.mock('../parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('./templates/templates', () => ({ prebuiltPresets: { OAI2: {} } }))
vi.mock('../polyfill', () => ({ safeStructuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) }))

import {
    buildPackerFormated,
    buildWriterFormated,
    getRecentHistoryBoundary,
    hashHistoryPrefix,
    normalizePackerPacket,
    runPacker,
    shouldActivatePacker,
} from './packerWriter'

describe('Packer-Writer history boundary', () => {
    beforeEach(() => {
        mocks.requestChatData.mockReset()
    })

    it('skips the packer on the first Writer turn and uses the greeting as baseline', () => {
        const messages = [{ role: 'user', data: 'Hello', chatId: 'u1' }] as any
        const boundary = getRecentHistoryBoundary(messages, 'Long greeting', 'char-1')

        expect(boundary.hasGeneratedReply).toBe(false)
        expect(boundary.previousReply).toMatchObject({ source: 'greeting', content: 'Long greeting' })
        expect(boundary.messagesAfterPreviousReply).toEqual(messages)
        expect(boundary.olderHistory).toEqual([])
    })

    it('starts without a baseline when there is no greeting', () => {
        const boundary = getRecentHistoryBoundary([{ role: 'user', data: 'Start' }] as any, '', 'char-1')
        expect(boundary.hasGeneratedReply).toBe(false)
        expect(boundary.previousReply).toBeNull()
        expect(boundary.messagesAfterPreviousReply).toHaveLength(1)
    })

    it('activates at the configurable Writer-reply threshold without an upper cap', () => {
        expect(shouldActivatePacker(0, 1)).toBe(false)
        expect(shouldActivatePacker(1, 1)).toBe(true)
        expect(shouldActivatePacker(4, 5)).toBe(false)
        expect(shouldActivatePacker(5, 5)).toBe(true)
        expect(shouldActivatePacker(99_999, 100_000)).toBe(false)
        expect(shouldActivatePacker(100_000, 100_000)).toBe(true)
    })

    it('keeps the complete normal request before the activation threshold', () => {
        const base = [
            { role: 'system', content: 'Static prompt' },
            { role: 'assistant', content: 'Greeting', removable: true },
            { role: 'user', content: 'Old user', memo: 'u1', removable: true },
            { role: 'assistant', content: 'Old AI', memo: 'a1', removable: true },
            { role: 'user', content: 'Current user', memo: 'u2' },
            { role: 'system', content: 'Post-everything protocol' },
        ] as any
        const writer = buildWriterFormated({
            base,
            writer: {} as any,
            packet: 'This must not be used before activation.',
            keepFullHistory: true,
        })

        expect(writer.slice(1).map((message) => message.content)).toEqual(base.map((message: any) => message.content))
        expect(writer.some((message) => message.content.includes('OLDER HISTORY CONTEXT'))).toBe(false)
    })

    it('keeps only AI 30 and the current user for the Writer after 30 turns', () => {
        const messages: any[] = []
        for (let i = 1; i <= 30; i++) {
            messages.push({ role: 'user', data: `User ${i}`, chatId: `u${i}` })
            messages.push({ role: 'char', data: `AI ${i}`, chatId: `a${i}`, saying: 'char-1' })
        }
        messages.push({ role: 'user', data: 'Current user', chatId: 'current' })

        const boundary = getRecentHistoryBoundary(messages, 'Greeting', 'char-1')
        expect(boundary.hasGeneratedReply).toBe(true)
        expect(boundary.previousReply?.content).toBe('AI 30')
        expect(boundary.messagesAfterPreviousReply.map((message) => message.data)).toEqual(['Current user'])
        expect(boundary.olderHistory).toHaveLength(59)

        const writer = buildWriterFormated({
            base: [
                { role: 'system', content: 'Character and image protocol' },
                ...messages.map((message) => ({ role: message.role === 'user' ? 'user' : 'assistant', content: message.data, memo: message.chatId, removable: true })),
            ] as any,
            writer: {} as any,
            packet: '[RELEVANT CONTEXT]\nAn old promise still matters.',
            previousReply: boundary.previousReply,
            messagesAfterPreviousReply: boundary.messagesAfterPreviousReply,
            historyMessages: boundary.visibleMessages,
        })

        expect(writer.some((message) => message.content === 'Character and image protocol')).toBe(true)
        expect(writer.some((message) => message.content === 'AI 29')).toBe(false)
        expect(writer.at(-2)?.content).toBe('AI 30')
        expect(writer.at(-1)?.content).toBe('Current user')
    })

    it('retains character example messages while removing real chat history', () => {
        const history = [{ role: 'user', data: 'Current user', chatId: 'u1' }] as any
        const writer = buildWriterFormated({
            base: [
                { role: 'system', content: '[Start a new chat]', memo: 'NewChatExample', removable: true },
                { role: 'assistant', content: 'Card example', name: 'example_assistant', removable: true },
                { role: 'assistant', content: 'Greeting', removable: true },
                { role: 'user', content: 'Current user', memo: 'u1' },
            ] as any,
            writer: {} as any,
            messagesAfterPreviousReply: history,
            historyMessages: history,
        })

        expect(writer.some((message) => message.content === 'Card example')).toBe(true)
        expect(writer.some((message) => message.content === 'Greeting')).toBe(false)
        expect(writer.filter((message) => message.content === 'Current user')).toHaveLength(1)
    })

    it('uses the rendered greeting and current user without duplicating either', () => {
        const currentUser = { role: 'user', data: 'Raw user', chatId: 'u1' } as any
        const writer = buildWriterFormated({
            base: [
                { role: 'system', content: '[Start a new chat]', memo: 'NewChat' },
                { role: 'assistant', content: 'Rendered greeting' },
                { role: 'system', content: 'Rendered user with speaker format', memo: 'u1' },
            ] as any,
            writer: {} as any,
            previousReply: { role: 'greeting', content: 'Raw {{char}} greeting', source: 'greeting' },
            messagesAfterPreviousReply: [currentUser],
            historyMessages: [currentUser],
        })

        expect(writer.filter((message) => message.content === 'Rendered greeting')).toHaveLength(1)
        expect(writer.some((message) => message.content === 'Raw {{char}} greeting')).toBe(false)
        expect(writer.at(-1)).toMatchObject({ role: 'system', content: 'Rendered user with speaker format' })
    })

    it('preserves normal prompt ordering while removing only older history', () => {
        const history = [
            { role: 'user', data: 'Old user', chatId: 'u1' },
            { role: 'char', data: 'Old AI', chatId: 'a1' },
            { role: 'user', data: 'Latest user', chatId: 'u2' },
        ] as any
        const writer = buildWriterFormated({
            base: [
                { role: 'system', content: 'Character card' },
                { role: 'user', content: 'Rendered old user', memo: 'u1', removable: true },
                { role: 'system', content: 'Depth lore between turns' },
                { role: 'assistant', content: 'Processed old AI', memo: 'a1', removable: true },
                { role: 'user', content: 'Rendered latest user', memo: 'u2', removable: true },
                { role: 'system', content: 'Post-everything protocol' },
            ] as any,
            writer: {} as any,
            packet: 'An earlier promise matters.',
            previousReply: { role: 'char', content: 'Old AI', chatId: 'a1', source: 'message' },
            messagesAfterPreviousReply: [history[2]],
            historyMessages: history,
        })

        expect(writer.map((message) => message.content)).toEqual([
            expect.any(String),
            'Character card',
            'Depth lore between turns',
            'OLDER HISTORY CONTEXT FROM PACKAGER:\nAn earlier promise matters.',
            'Old AI',
            'Rendered latest user',
            'Post-everything protocol',
        ])
    })

    it('keeps every category of normal non-history context for Writer', () => {
        const staticContext = [
            'Main preset prompt',
            'Character card',
            'Persona',
            'Lore and world',
            'Memory',
            'Author note',
            'Jailbreak and output protocol',
            'Timestamp and speaker format',
            'Image configuration and asset keys',
            'Post-everything instruction',
        ]
        const oldHistory = { role: 'user', data: 'Old history', chatId: 'old' } as any
        const latestUser = { role: 'user', data: 'Latest user', chatId: 'latest' } as any
        const writer = buildWriterFormated({
            base: [
                ...staticContext.slice(0, 5).map((content) => ({ role: 'system', content })),
                { role: 'user', content: 'Old history', memo: 'old', removable: true },
                ...staticContext.slice(5).map((content) => ({ role: 'system', content })),
                { role: 'user', content: 'Latest user rendered', memo: 'latest' },
            ] as any,
            writer: {} as any,
            messagesAfterPreviousReply: [latestUser],
            historyMessages: [oldHistory, latestUser],
        })

        for (const content of staticContext) {
            expect(writer.some((message) => message.content === content)).toBe(true)
        }
        expect(writer.some((message) => message.content === 'Old history')).toBe(false)
        expect(writer.some((message) => message.content === 'Latest user rendered')).toBe(true)
    })

    it('does not add an empty NONE packet to Writer context', () => {
        const writer = buildWriterFormated({
            base: [{ role: 'system', content: 'Static context' }],
            writer: {} as any,
            packet: '[RELEVANT CONTEXT]\nNONE',
        })
        expect(writer.some((message) => message.content.includes('OLDER HISTORY CONTEXT'))).toBe(false)
    })

    it('anchors only on the current speaker in group chat', () => {
        const boundary = getRecentHistoryBoundary([
            { role: 'char', data: 'Current character reply', saying: 'char-1' },
            { role: 'user', data: 'User follow-up' },
            { role: 'char', data: 'Other character reply', saying: 'char-2' },
            { role: 'user', data: 'Current user' },
        ] as any, '', 'char-1', true)

        expect(boundary.previousReply?.content).toBe('Current character reply')
        expect(boundary.generatedReplyCount).toBe(1)
        expect(boundary.messagesAfterPreviousReply.map((message) => message.data)).toEqual([
            'User follow-up',
            'Other character reply',
            'Current user',
        ])
    })

    it('respects disabled messages and allBefore reset', () => {
        const boundary = getRecentHistoryBoundary([
            { role: 'char', data: 'Old reply', saying: 'char-1' },
            { role: 'user', data: 'Reset', disabled: 'allBefore' },
            { role: 'char', data: 'Hidden reply', saying: 'char-1', disabled: true },
            { role: 'user', data: 'Visible user' },
        ] as any, 'Ignored greeting', 'char-1')

        expect(boundary.hasGeneratedReply).toBe(false)
        expect(boundary.previousReply).toBeNull()
        expect(boundary.greeting).toBe('')
        expect(boundary.visibleMessages.map((message) => message.data)).toEqual(['Visible user'])
        expect(hashHistoryPrefix([
            { role: 'char', data: 'Old reply', disabled: 'allBefore' },
            { role: 'user', data: 'Visible user' },
        ] as any, 'Ignored greeting')).toBe(hashHistoryPrefix([{ role: 'user', data: 'Visible user' }] as any))
    })

    it('sends only quoted conversation history to the packer', () => {
        const boundary = getRecentHistoryBoundary([
            { role: 'char', data: 'Previous writer reply', saying: 'char-1' },
            { role: 'user', data: 'Current request' },
        ] as any, 'Greeting', 'char-1')
        const prompt = buildPackerFormated({
            packer: {} as any,
            boundary,
            currentUserMessage: 'Current request',
        })

        const joined = prompt.map((message) => message.content).join('\n')
        expect(joined).toContain('Previous writer reply')
        expect(joined).toContain('Current request')
        expect(joined).not.toContain('character card')
        expect(joined).not.toContain('WRITING STYLE')
        expect(joined).not.toContain('[DIRECTION]')
    })

    it('does not require packet markup and removes exposed reasoning', () => {
        expect(normalizePackerPacket('<Thoughts>private</Thoughts>\nThe promise from turn two matters.')).toBe('The promise from turn two matters.')
        expect(normalizePackerPacket('<final>[RELEVANT CONTEXT]\nKeep the promise.</final>')).toBe('[RELEVANT CONTEXT]\nKeep the promise.')
        expect(normalizePackerPacket('<think>unfinished')).toBe('')
    })

    it('uses a non-streaming packer request and retries only an empty final response', async () => {
        mocks.requestChatData
            .mockResolvedValueOnce({ type: 'success', result: '<think>unfinished', model: 'packer-model' })
            .mockResolvedValueOnce({ type: 'success', result: 'NONE', model: 'packer-model' })

        const result = await runPacker({
            formated: [{ role: 'system', content: 'Packer prompt' }],
            packer: { aiModel: 'packer-model' } as any,
        })

        expect(result.ok).toBe(true)
        expect(result.packet).toBe('NONE')
        expect(result.attempts).toBe(2)
        expect(mocks.requestChatData).toHaveBeenCalledTimes(2)
        expect(mocks.requestChatData.mock.calls[0][0]).toMatchObject({
            useStreaming: false,
            noMultiGen: true,
            staticModel: 'packer-model',
        })
    })
})
