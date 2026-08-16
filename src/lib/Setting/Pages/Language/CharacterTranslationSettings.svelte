<script lang="ts">
    import { language } from "src/lang";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import { DBState } from "src/ts/stores.svelte";

    function normalizePositiveInteger(value: number, fallback: number): number {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric >= 1
            ? Math.floor(numeric)
            : fallback;
    }

    function normalizeBatchSize() {
        DBState.db.characterTranslationBatchSize = normalizePositiveInteger(
            DBState.db.characterTranslationBatchSize,
            12,
        );
    }

    function normalizeRequestCharacterLimit() {
        DBState.db.characterTranslationRequestCharLimit = normalizePositiveInteger(
            DBState.db.characterTranslationRequestCharLimit,
            12000,
        );
    }

    function normalizeConcurrency() {
        DBState.db.characterTranslationConcurrency = normalizePositiveInteger(
            DBState.db.characterTranslationConcurrency,
            2,
        );
    }

    $effect(() => {
        const presetCount = DBState.db.botPresets.length;
        const selected = DBState.db.characterTranslationPresetId;
        if (presetCount > 0 && (selected < 0 || selected >= presetCount)) {
            DBState.db.characterTranslationPresetId = Math.min(
                Math.max(DBState.db.botPresetsId, 0),
                presetCount - 1,
            );
        }
    });
</script>

<section class="mb-6 rounded-md border border-darkborderc p-4">
    <h2 class="mb-1 text-2xl font-bold text-textcolor">{language.characterTranslationSettings}</h2>
    <p class="mb-4 text-sm text-textcolor2">{language.characterTranslationSettingsDescription}</p>

    <label class="mb-1 block text-sm text-textcolor2" for="character-translation-settings-preset">
        {language.characterTranslationAIPreset}
    </label>
    <select
        id="character-translation-settings-preset"
        class="mb-4 w-full rounded-md border border-darkborderc bg-transparent px-3 py-2 text-textcolor shadow-xs transition-colors duration-200 focus:border-borderc focus:outline-hidden focus:ring-2 focus:ring-borderc"
        bind:value={DBState.db.characterTranslationPresetId}
        disabled={DBState.db.botPresets.length === 0}
    >
        {#each DBState.db.botPresets as preset, i}
            <option class="bg-darkbg" value={i}>{preset.name || `Preset ${i + 1}`}</option>
        {/each}
    </select>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label class="text-sm text-textcolor2">
            <span class="mb-1 block">{language.characterTranslationBatchSize}</span>
            <NumberInput
                fullwidth
                min={1}
                bind:value={DBState.db.characterTranslationBatchSize}
                onChange={normalizeBatchSize}
            />
        </label>
        <label class="text-sm text-textcolor2">
            <span class="mb-1 block">{language.characterTranslationRequestCharLimit}</span>
            <NumberInput
                fullwidth
                min={1}
                bind:value={DBState.db.characterTranslationRequestCharLimit}
                onChange={normalizeRequestCharacterLimit}
            />
        </label>
        <label class="text-sm text-textcolor2">
            <span class="mb-1 block">{language.characterTranslationConcurrency}</span>
            <NumberInput
                fullwidth
                min={1}
                bind:value={DBState.db.characterTranslationConcurrency}
                onChange={normalizeConcurrency}
            />
        </label>
    </div>

    <p class="mt-3 text-xs text-textcolor2">{language.characterTranslationNoHardLimit}</p>
</section>
