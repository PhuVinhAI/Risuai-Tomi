import { describe, expect, it } from "vitest";
import { languageEnglish } from "./en";
import { languageVietnamese } from "./vi";

type TranslationLeaf = string | string[] | ((...args: any[]) => string);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenTranslations(
    value: Record<string, unknown>,
    prefix = "",
    output = new Map<string, TranslationLeaf>(),
): Map<string, TranslationLeaf> {
    Object.entries(value).forEach(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isRecord(child)) {
            flattenTranslations(child, path, output);
        }
        else {
            output.set(path, child as TranslationLeaf);
        }
    });
    return output;
}

function syntaxTokens(text: string): string[] {
    return Array.from(text.matchAll(
        /\{\{[^{}\r\n]+\}\}|(?<!\{)\{(?:[A-Za-z_][\w]*|\d*)\}(?!\})|<\/?[A-Za-z][^<>]*>|\$[&`$]|\$\d+/g,
    )).map((match) => match[0]);
}

const intentionallySharedText = new Set([
    "formating.lorebook",
    "triggerCategories.Lorebook V2",
    "triggerDesc.v2CommentDesc",
    "triggerInputLabels.prompt",
    "triggerInputLabels.regex",
    "triggerInputLabels.boolNull",
    "loreBook",
    "prompt",
    "plugin",
    "SuperMemory",
    "streaming",
    "hub",
    "persona",
    "HypaMemory",
    "deeplXUrl",
    "charjs",
    "topP",
    "hanuraiMemory",
    "regex",
    "jsonSchema",
    "hypaV3Modal.titleLabel",
    "email",
]);

describe("Vietnamese translations", () => {
    const english = flattenTranslations(languageEnglish);
    const vietnamese = flattenTranslations(languageVietnamese);

    it("covers the complete English key tree without stale keys", () => {
        expect([...vietnamese.keys()].sort()).toEqual([...english.keys()].sort());
    });

    it("keeps the same value kind for every key", () => {
        english.forEach((source, path) => {
            const translated = vietnamese.get(path);
            expect(Array.isArray(translated), path).toBe(Array.isArray(source));
            expect(typeof translated, path).toBe(typeof source);
        });
    });

    it("does not silently leave English UI copy untranslated", () => {
        const untranslated = [...english.entries()]
            .filter(([path, source]) =>
                typeof source === "string"
                && source === vietnamese.get(path)
                && !intentionallySharedText.has(path)
            )
            .map(([path]) => path);

        expect(untranslated).toEqual([]);
    });

    it("preserves placeholders and markup tokens used by the UI", () => {
        const missingTokens: string[] = [];
        english.forEach((source, path) => {
            if (typeof source !== "string") return;
            const translated = vietnamese.get(path);
            expect(typeof translated, path).toBe("string");
            syntaxTokens(source).forEach((token) => {
                if (!(translated as string).includes(token)) {
                    missingTokens.push(`${path}: ${token}`);
                }
            });
        });
        expect(missingTokens).toEqual([]);
    });

    it("preserves arguments in translated message functions", () => {
        english.forEach((source, path) => {
            if (typeof source !== "function") return;
            const translated = vietnamese.get(path);
            expect(typeof translated, path).toBe("function");
            expect((translated as (...args: any[]) => string).length, path).toBe(source.length);

            const args = Array.from({ length: source.length }, (_, index) => `__RISU_ARG_${index}__`);
            const sourceResult = source(...args);
            const translatedResult = (translated as (...args: any[]) => string)(...args);
            args.forEach((arg) => {
                if (sourceResult.includes(arg)) {
                    expect(translatedResult, `${path} must preserve argument ${arg}`).toContain(arg);
                }
            });
        });
    });
});
