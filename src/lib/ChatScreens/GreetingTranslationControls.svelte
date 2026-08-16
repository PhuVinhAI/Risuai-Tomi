<script lang="ts">
    import { LanguagesIcon, PauseIcon, PlayIcon, XIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { alertError } from "src/ts/alert";
    import { DBState } from "src/ts/stores.svelte";
    import {
        cancelCharacterTranslation,
        continueCharacterTranslation,
        createCharacterTextTranslationSession,
        pauseCharacterTranslation,
        type CharacterTranslationSession,
        type CharacterTranslationStatus,
    } from "src/ts/translator/characterTranslation";
    import { onDestroy } from "svelte";

    interface Props {
        source: string;
        onTranslated: (translated: string) => void;
        showNames?: boolean;
    }

    let { source, onTranslated, showNames = false }: Props = $props();
    let session: CharacterTranslationSession | null = null;
    let status = $state<CharacterTranslationStatus | "idle">("idle");

    function syncStatus() {
        status = session?.status ?? "idle";
    }

    async function continueTranslation() {
        const activeSession = session;
        if (!activeSession) return;

        syncStatus();
        const nextStatus = await continueCharacterTranslation(activeSession, () => {
            if (session !== activeSession) return;
            syncStatus();
        });
        if (session !== activeSession) return;

        syncStatus();
        if (nextStatus === "completed") {
            session = null;
            status = "idle";
        }
        else if (nextStatus === "error") {
            alertError(activeSession.error);
        }
    }

    async function startTranslation() {
        if (session || !source.trim()) return;
        const preset = DBState.db.botPresets[DBState.db.characterTranslationPresetId];
        if (!preset) {
            alertError(language.characterTranslationNoPreset);
            return;
        }

        session = createCharacterTextTranslationSession(
            source,
            preset,
            onTranslated,
            {
                batchSize: DBState.db.characterTranslationBatchSize,
                requestCharLimit: DBState.db.characterTranslationRequestCharLimit,
                concurrency: DBState.db.characterTranslationConcurrency,
            },
        );
        syncStatus();
        await continueTranslation();
    }

    function pauseTranslation() {
        if (!session) return;
        pauseCharacterTranslation(session);
        syncStatus();
    }

    function cancelTranslation() {
        if (!session) return;
        cancelCharacterTranslation(session);
        session = null;
        status = "idle";
    }

    onDestroy(() => {
        if (session) cancelCharacterTranslation(session);
    });
</script>

<span class="flex items-center gap-2">
    {#if status === "idle"}
        <button
            class="flex items-center cursor-pointer hover:text-blue-500 transition-colors button-icon-translate-greeting"
            disabled={!source.trim()}
            title={language.translateGreetingToVietnamese}
            onclick={startTranslation}
        >
            <LanguagesIcon size={20} />
            {#if showNames}
                <span class="ml-1">{language.translateGreetingToVietnamese}</span>
            {/if}
        </button>
    {:else if status === "paused" || status === "error"}
        <button
            class="flex items-center hover:text-blue-500 transition-colors"
            title={language.characterTranslationResume}
            onclick={continueTranslation}
        >
            <PlayIcon size={20} />
            {#if showNames}<span class="ml-1">{language.characterTranslationResume}</span>{/if}
        </button>
        <button
            class="flex items-center hover:text-draculared transition-colors"
            title={language.cancel}
            onclick={cancelTranslation}
        >
            <XIcon size={20} />
        </button>
    {:else}
        <button
            class="flex items-center hover:text-blue-500 transition-colors"
            disabled={status === "pausing"}
            title={language.characterTranslationPause}
            onclick={pauseTranslation}
        >
            <PauseIcon size={20} />
            {#if showNames}<span class="ml-1">{language.characterTranslationPause}</span>{/if}
        </button>
        <button
            class="flex items-center hover:text-draculared transition-colors"
            title={language.cancel}
            onclick={cancelTranslation}
        >
            <XIcon size={20} />
        </button>
    {/if}
</span>
