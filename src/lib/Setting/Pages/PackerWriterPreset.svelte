<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import {
        defaultPackerPrompt,
        defaultWriterPrompt,
        type PackerWriterRole,
    } from "src/ts/process/packerWriter";

    const currentPreset = $derived(
        DBState.db.botPresetsId >= 0 ? DBState.db.botPresets?.[DBState.db.botPresetsId] : null
    )
    const currentRole = $derived<PackerWriterRole | 'none'>(currentPreset?.pwRole ?? 'none')

    function setRole(role: string) {
        if (!currentPreset) return
        const next = role === 'packer' || role === 'writer' ? role : null
        if (currentPreset.pwRole === next) return
        currentPreset.pwRole = next
        currentPreset.pwPrompt = ''
    }

    $effect(() => {
        if (currentPreset?.pwRole) currentPreset.pwPrompt ??= ''
    })
</script>

{#if currentPreset}
    <Accordion name={language.packerWriterRole} styled>
        <span class="text-textcolor2 text-sm">{language.packerWriterRoleDesc}</span>
        <SelectInput value={currentRole} onchange={(event) => setRole(event.currentTarget.value)}>
            <OptionInput value="none">{language.packerWriterRoleNone}</OptionInput>
            <OptionInput value="packer">{language.packerWriterRolePacker}</OptionInput>
            <OptionInput value="writer">{language.packerWriterRoleWriter}</OptionInput>
        </SelectInput>

        {#if currentRole === 'packer'}
            <span class="text-textcolor mt-4">{language.packerRolePrompt}</span>
            <TextAreaInput bind:value={currentPreset.pwPrompt} placeholder={defaultPackerPrompt}/>
        {:else if currentRole === 'writer'}
            <span class="text-textcolor mt-4">{language.writerRolePrompt}</span>
            <TextAreaInput bind:value={currentPreset.pwPrompt} placeholder={defaultWriterPrompt}/>
        {/if}
    </Accordion>
{/if}
