import { beforeEach, describe, expect, it, vi } from "vitest";
import type { botPreset, character } from "../storage/database.svelte";

const mocks = vi.hoisted(() => ({
    requestChatData: vi.fn(),
}));

vi.mock("../process/request/request", () => ({
    requestChatData: mocks.requestChatData,
}));

vi.mock("../util", () => ({
    parseMultilangString: (data: string) => ({ xx: data }),
    encodeMultilangString: (data: Record<string, string>) => Object.entries(data)
        .map(([code, value]) => `\n# \`${code}\`\n${value}`)
        .join(""),
}));

import {
    cancelCharacterTranslation,
    characterCardTranslationSystemPrompt,
    collectCharacterTranslationSlots,
    continueCharacterTranslation,
    createCharacterTranslationSession,
    pauseCharacterTranslation,
    translateCharacterCard,
    translateCharacterText,
} from "./characterTranslation";

function makePreset(): botPreset {
    return {
        name: "Translation AI",
        mainPrompt: "ROLEPLAY PROMPT THAT MUST NOT BE SENT",
        jailbreak: "JAILBREAK THAT MUST NOT BE SENT",
        globalNote: "GLOBAL NOTE THAT MUST NOT BE SENT",
        bias: [["preferred", 0.5]],
        temperature: 73,
        maxContext: 32000,
        maxResponse: 4096,
        frequencyPenalty: 12,
        PresensePenalty: 7,
        formatingOrder: [],
        promptPreprocess: false,
        ooba: {} as botPreset["ooba"],
        ainconfig: {} as botPreset["ainconfig"],
    };
}

function makeCharacter(): character {
    return {
        type: "character",
        name: "Miyabi",
        image: "asset-key",
        firstMessage: "Hello <pimg src=\"Miyabi.office.smile\">",
        desc: "A strict CEO.",
        notes: "Internal character notes.",
        chats: [],
        chatFolders: [],
        chatPage: 0,
        viewScreen: "none",
        bias: [],
        emotionImages: [],
        globalLore: [{
            key: "Akatsuki Corporation",
            secondkey: "Tokyo",
            insertorder: 1,
            comment: "Company background",
            content: "The company controls a large market.",
            mode: "normal",
            alwaysActive: false,
            selective: false,
        }],
        chaId: "char-id",
        sdData: [],
        customscript: [{ comment: "script", in: "foo", out: "bar", type: "editoutput" }],
        triggerscript: [],
        utilityBot: false,
        exampleMessage: "Example dialogue.",
        creatorNotes: "Creator note.",
        systemPrompt: "Stay in character.",
        postHistoryInstructions: "Remember the scene.",
        alternateGreetings: ["Alternate hello."],
        tags: ["CEO"],
        creator: "Author",
        characterVersion: "1.0",
        personality: "Protective.",
        scenario: "At home.",
        firstMsgIndex: -1,
        replaceGlobalNote: "Replacement note.",
        additionalText: "Additional prompt text.",
        defaultVariables: '{"relationship":"family"}',
        translatorNote: "Use formal speech.",
        depth_prompt: { depth: 2, prompt: "Keep the relationship consistent." },
        additionalAssets: [["smile", "Miyabi.office.smile", "png"]],
    };
}

function translateRequestContent(request: { formated: { content: string }[] }, prefix = "VI:"): string {
    const content = request.formated[1].content;
    try {
        const parsed = JSON.parse(content) as {
            items?: { id: string; text: string }[];
        };
        if (Array.isArray(parsed.items)) {
            return JSON.stringify({
                items: parsed.items.map((item) => ({
                    id: item.id,
                    text: `${prefix}${item.text}`,
                })),
            });
        }
    }
    catch {
        // Single-item requests deliberately retain the plain-text protocol.
    }
    return `${prefix}${content}`;
}

describe("character-card translation", () => {
    beforeEach(() => {
        mocks.requestChatData.mockReset();
    });

    it("uses the selected preset unchanged but sends only the fixed translation prompt", async () => {
        const preset = makePreset();
        const originalPreset = structuredClone(preset);
        mocks.requestChatData.mockResolvedValue({
            type: "success",
            result: "<Thoughts>reasoning</Thoughts>\nXin chao",
        });

        await expect(translateCharacterText("Hello", preset)).resolves.toBe("Xin chao");

        const [request, mode] = mocks.requestChatData.mock.calls[0];
        expect(mode).toBe("translate");
        expect(request.presetOverride).toBe(preset);
        expect(preset).toEqual(originalPreset);
        expect(request.biasString).toBe(preset.bias);
        expect(request.useStreaming).toBe(false);
        expect(request.noMultiGen).toBe(true);
        expect(request.skipRequestTrigger).toBe(true);
        expect(request.formated).toEqual([
            { role: "system", content: characterCardTranslationSystemPrompt },
            { role: "user", content: "Hello" },
        ]);
        expect(JSON.stringify(request.formated)).not.toContain(preset.mainPrompt);
        expect(JSON.stringify(request.formated)).not.toContain(preset.jailbreak);
        expect(JSON.stringify(request.formated)).not.toContain(preset.globalNote);
        expect(request).not.toHaveProperty("maxTokens");
        expect(request).not.toHaveProperty("temperature");
        expect(request).not.toHaveProperty("frequencyPenalty");
        expect(request).not.toHaveProperty("PresensePenalty");
        expect(request).not.toHaveProperty("staticModel");
        expect(request).not.toHaveProperty("aiModel");
        expect(request).not.toHaveProperty("blockPlugins");
    });

    it("detects and protects each source's syntax without a card-specific hardcoded protocol", async () => {
        expect(characterCardTranslationSystemPrompt).not.toContain("<pimg>");
        expect(characterCardTranslationSystemPrompt).not.toContain("{{...");
        expect(characterCardTranslationSystemPrompt).not.toContain(":phrase");
        expect(characterCardTranslationSystemPrompt).not.toContain("§sound");

        const source = 'Hello **warm greeting** ¤soft sound¤ <scene-image asset="hero.office.smile"> {{player_name}}';
        mocks.requestChatData.mockImplementation(async (request) => ({
            type: "success",
            result: request.formated[1].content.replace("Hello", "Xin chao"),
        }));

        await expect(translateCharacterText(source, makePreset())).resolves.toBe(
            'Xin chao **warm greeting** ¤soft sound¤ <scene-image asset="hero.office.smile"> {{player_name}}',
        );

        const request = mocks.requestChatData.mock.calls[0][0];
        expect(request.formated[0].content).toContain("Source-specific syntax profile");
        expect(request.formated[0].content).toContain("¤");
        expect(request.formated[1].content).not.toContain("scene-image");
        expect(request.formated[1].content).not.toContain("hero.office.smile");
        expect(request.formated[1].content).not.toContain("player_name");
        expect(request.formated[1].content).toContain("RISU_LOCK_");
        expect(request.formated[1].content).toContain("**warm greeting**");
    });

    it("keeps a failed checkpoint and resumes the same field", async () => {
        const char = makeCharacter();
        const session = createCharacterTranslationSession(char, makePreset(), "greeting");
        mocks.requestChatData
            .mockResolvedValueOnce({ type: "fail", result: "Temporary provider error" })
            .mockImplementationOnce(async (request) => ({
                type: "success",
                result: request.formated[1].content.replace("Hello", "Xin chao"),
            }));

        await expect(continueCharacterTranslation(session)).resolves.toBe("error");
        expect(session.current).toBe(0);
        expect(session.error).toBe("Temporary provider error");
        expect(char.firstMessage).toBe('Hello <pimg src="Miyabi.office.smile">');

        await expect(continueCharacterTranslation(session)).resolves.toBe("completed");
        expect(session.current).toBe(1);
        expect(char.firstMessage).toBe('Xin chao <pimg src="Miyabi.office.smile">');
        expect(mocks.requestChatData).toHaveBeenCalledTimes(2);
    });

    it("pauses the active request, resumes it, and cancels without applying partial work", async () => {
        const char = makeCharacter();
        const originalGreeting = char.firstMessage;
        const session = createCharacterTranslationSession(char, makePreset(), "greeting");
        let finishRequest!: (value: { type: "success"; result: string }) => void;
        mocks.requestChatData.mockReturnValueOnce(new Promise((resolve) => {
            finishRequest = resolve;
        }));

        const run = continueCharacterTranslation(session);
        pauseCharacterTranslation(session);
        expect(session.status).toBe("pausing");
        expect(mocks.requestChatData.mock.calls[0][2].aborted).toBe(true);
        finishRequest!({ type: "success", result: "Discarded translation" });

        await expect(run).resolves.toBe("paused");
        expect(session.current).toBe(0);
        expect(char.firstMessage).toBe(originalGreeting);

        mocks.requestChatData.mockResolvedValueOnce({ type: "success", result: "Ban dich moi" });
        const resumed = continueCharacterTranslation(session);
        cancelCharacterTranslation(session);
        await resumed;
        expect(session.status).toBe("cancelled");
        expect(char.firstMessage).toBe(originalGreeting);
    });

    it("limits greeting translation to the primary greeting", () => {
        const char = makeCharacter();
        const slots = collectCharacterTranslationSlots(char, "greeting");

        expect(slots.map((slot) => slot.label)).toEqual(["Greeting"]);
        slots[0].apply("Xin chao");
        expect(char.firstMessage).toBe("Xin chao");
        expect(char.desc).toBe("A strict CEO.");
        expect(char.alternateGreetings).toEqual(["Alternate hello."]);
    });

    it("translates character prose and lore content without touching technical keys", async () => {
        const char = makeCharacter();
        const preset = makePreset();
        mocks.requestChatData.mockImplementation(async (request) => ({
            type: "success",
            result: translateRequestContent(request),
        }));

        const count = await translateCharacterCard(char, preset, "all");
        const sourceTexts = mocks.requestChatData.mock.calls.map(([request]) => request.formated[1].content);

        expect(count).toBeGreaterThan(10);
        expect(mocks.requestChatData.mock.calls.length).toBeLessThan(count);
        expect(mocks.requestChatData.mock.calls.length).toBe(2);
        expect(mocks.requestChatData.mock.calls.every(([request]) =>
            request.useStreaming === false
            && request.noMultiGen === true
            && request.presetOverride === preset
        )).toBe(true);
        expect(char.firstMessage).toBe('VI:Hello <pimg src="Miyabi.office.smile">');
        expect(char.desc).toBe("VI:A strict CEO.");
        expect(char.alternateGreetings).toEqual(["VI:Alternate hello."]);
        expect(char.globalLore[0].comment).toBe("VI:Company background");
        expect(char.globalLore[0].content).toBe("VI:The company controls a large market.");
        expect(char.globalLore[0].key).toBe("Akatsuki Corporation");
        expect(char.globalLore[0].secondkey).toBe("Tokyo");
        expect(char.defaultVariables).toBe('{"relationship":"family"}');
        expect(char.additionalAssets).toEqual([["smile", "Miyabi.office.smile", "png"]]);
        expect(char.customscript[0]).toEqual({ comment: "script", in: "foo", out: "bar", type: "editoutput" });
        expect(sourceTexts).not.toContain("Akatsuki Corporation");
        expect(sourceTexts).not.toContain("Miyabi.office.smile");
        expect(sourceTexts).not.toContain('{"relationship":"family"}');
        expect(char.creatorNotes).toContain("# `vi`\nVI:Creator note.");
    });

    it("does not partially update the card when a later request fails", async () => {
        const char = makeCharacter();
        const preset = makePreset();
        const originalGreeting = char.firstMessage;
        const originalDescription = char.desc;
        mocks.requestChatData
            .mockImplementationOnce(async (request) => ({
                type: "success",
                result: translateRequestContent(request),
            }))
            .mockResolvedValueOnce({ type: "fail", result: "Provider failed" });

        await expect(translateCharacterCard(char, preset, "all")).rejects.toThrow("Provider failed");
        expect(char.firstMessage).toBe(originalGreeting);
        expect(char.desc).toBe(originalDescription);
    });

    it("resumes at the failed batch without repeating completed batches", async () => {
        const char = makeCharacter();
        const preset = makePreset();
        const originalGreeting = char.firstMessage;
        const session = createCharacterTranslationSession(char, preset, "all");
        mocks.requestChatData
            .mockImplementationOnce(async (request) => ({
                type: "success",
                result: translateRequestContent(request),
            }))
            .mockResolvedValueOnce({ type: "fail", result: "Temporary batch error" })
            .mockImplementationOnce(async (request) => ({
                type: "success",
                result: translateRequestContent(request),
            }));

        await expect(continueCharacterTranslation(session)).resolves.toBe("error");
        expect(session.current).toBe(12);
        expect(session.batchCurrent).toBe(1);
        expect(session.batchTotal).toBe(2);
        expect(char.firstMessage).toBe(originalGreeting);

        await expect(continueCharacterTranslation(session)).resolves.toBe("completed");
        expect(mocks.requestChatData).toHaveBeenCalledTimes(3);
        expect(char.firstMessage).toBe('VI:Hello <pimg src="Miyabi.office.smile">');
    });

    it("starts configured batches concurrently", async () => {
        const char = makeCharacter();
        const preset = makePreset();
        const releases: (() => void)[] = [];
        mocks.requestChatData.mockImplementation((request) => new Promise((resolve) => {
            releases.push(() => resolve({
                type: "success",
                result: translateRequestContent(request),
            }));
        }));
        const session = createCharacterTranslationSession(char, preset, "all", {
            concurrency: 2,
        });

        const running = continueCharacterTranslation(session);
        await Promise.resolve();
        expect(session.batchTotal).toBe(2);
        expect(mocks.requestChatData).toHaveBeenCalledTimes(2);
        releases.forEach((release) => release());

        await expect(running).resolves.toBe("completed");
    });

    it("does not cap user-provided execution settings", () => {
        const session = createCharacterTranslationSession(
            makeCharacter(),
            makePreset(),
            "all",
            {
                batchSize: 1_000_000,
                requestCharLimit: 1_000_000_000,
                concurrency: 1_000_000,
            },
        );

        expect(session.batchTotal).toBe(1);
    });
});
