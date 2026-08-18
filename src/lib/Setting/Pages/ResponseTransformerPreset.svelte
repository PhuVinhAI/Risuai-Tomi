<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import { defaultResponseTransformerPrompt } from "src/ts/process/responseTransformer";

    const currentPreset = $derived(
        DBState.db.botPresetsId >= 0 ? DBState.db.botPresets?.[DBState.db.botPresetsId] : null
    )

    $effect(() => {
        if (currentPreset) {
            currentPreset.transformerEnabled ??= false
            currentPreset.transformerPrompt ??= ''
        }
    })
</script>

{#if currentPreset}
    <Accordion name={language.responseTransformerPresetRole} styled>
        <span class="text-textcolor2 text-sm">{language.responseTransformerPresetRoleDesc}</span>
        <Check bind:check={currentPreset.transformerEnabled} name={language.responseTransformerPresetEnabled} className="mt-3"/>
        {#if currentPreset.transformerEnabled}
            <span class="text-textcolor mt-4">{language.responseTransformerPrompt}</span>
            <TextAreaInput bind:value={currentPreset.transformerPrompt} placeholder={defaultResponseTransformerPrompt}/>
        {/if}
    </Accordion>
{/if}
