<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import { PlusIcon } from "@lucide/svelte";
    import {
        createTransformerPreset,
        defaultResponseTransformerSettings,
        listTransformerPresets,
    } from "src/ts/process/responseTransformer";

    DBState.db.responseTransformer ??= { ...defaultResponseTransformerSettings }

    const transformerPresets = $derived(listTransformerPresets())

    function addTransformerPreset() {
        const preset = createTransformerPreset()
        const existing = new Set((DBState.db.botPresets ?? []).map((item) => item?.name))
        let name = preset.name ?? 'Response Transformer'
        let suffix = 2
        while (existing.has(name)) {
            name = `${preset.name} ${suffix}`
            suffix++
        }
        preset.name = name
        DBState.db.botPresets = [...(DBState.db.botPresets ?? []), preset]
        DBState.db.responseTransformer.preset = name
    }
</script>

<Check bind:check={DBState.db.responseTransformer.enabled} name={language.responseTransformerEnabled} className="mt-2"/>

{#if DBState.db.responseTransformer.enabled}
    <span class="text-textcolor mt-4">{language.responseTransformerPreset}</span>
    {#if transformerPresets.length === 0}
        <div class="flex items-center gap-2">
            <span class="text-draculared text-sm">{language.responseTransformerNoPresets}</span>
            <button class="bg-selected text-textcolor p-2 rounded-md shrink-0" onclick={addTransformerPreset} aria-label={language.responseTransformerPreset}>
                <PlusIcon size={16}/>
            </button>
        </div>
    {:else}
        <SelectInput bind:value={DBState.db.responseTransformer.preset}>
            <OptionInput value="">---</OptionInput>
            {#each transformerPresets as preset}
                <OptionInput value={preset.name}>{preset.name}</OptionInput>
            {/each}
        </SelectInput>
    {/if}
    <span class="text-textcolor2 text-sm mt-2">{language.responseTransformerPresetDesc}</span>
{/if}
