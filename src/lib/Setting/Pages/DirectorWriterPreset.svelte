<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from "@lucide/svelte";
    import {
        defaultDirectorPrompt,
        defaultPacketSchema,
        defaultWriterPrompt,
        ensureWritingStyleSchema,
        type DirectorWriterRole,
    } from "src/ts/process/directorWriter";

    const currentPreset = $derived(
        DBState.db.botPresetsId >= 0 ? DBState.db.botPresets?.[DBState.db.botPresetsId] : null
    )
    const currentRole = $derived<DirectorWriterRole | 'none'>(currentPreset?.dwRole ?? 'none')

    function setRole(role: string) {
        if (!currentPreset) {
            return
        }
        const next = role === 'director' || role === 'writer' ? role : null
        if (currentPreset.dwRole === next) {
            return
        }
        currentPreset.dwRole = next
        // The prompt is role-specific, so carrying it across a role change would leave
        // writer instructions on a director preset.
        currentPreset.dwPrompt = ''
        if (next === 'director' && !currentPreset.dwSchema?.length) {
            currentPreset.dwSchema = defaultPacketSchema()
        }
    }

    function moveSchemaRow(index: number, delta: number) {
        if (!currentPreset?.dwSchema) {
            return
        }
        const rows = [...currentPreset.dwSchema]
        const target = index + delta
        if (target < 0 || target >= rows.length) {
            return
        }
        const [moved] = rows.splice(index, 1)
        rows.splice(target, 0, moved)
        currentPreset.dwSchema = rows
    }

    // Keep the bound fields defined so the inputs never bind to undefined.
    $effect(() => {
        const preset = currentPreset
        if (!preset || !preset.dwRole) {
            return
        }
        preset.dwPrompt ??= ''
        if (preset.dwRole === 'director' && !preset.dwSchema?.length) {
            preset.dwSchema = defaultPacketSchema()
        }
        else if (preset.dwRole === 'director' && preset.dwSchema) {
            const schema = ensureWritingStyleSchema(preset.dwSchema)
            if (schema !== preset.dwSchema) {
                preset.dwSchema = schema
            }
        }
    })
</script>

{#if currentPreset}
    <Accordion name={language.directorWriterRole} styled>
        <span class="text-textcolor2 text-sm">{language.directorWriterRoleDesc}</span>
        <SelectInput value={currentRole} onchange={(e) => setRole(e.currentTarget.value)}>
            <OptionInput value="none">{language.directorWriterRoleNone}</OptionInput>
            <OptionInput value="director">{language.directorWriterRoleDirector}</OptionInput>
            <OptionInput value="writer">{language.directorWriterRoleWriter}</OptionInput>
        </SelectInput>

        {#if currentRole === 'director'}
            <span class="text-textcolor mt-4">{language.directorRolePrompt}</span>
            <TextAreaInput bind:value={currentPreset.dwPrompt} placeholder={defaultDirectorPrompt}/>

            <div class="flex items-center justify-between mt-4">
                <span class="text-textcolor">{language.packetSchema}</span>
                <button class="text-sm text-textcolor2 hover:text-green-500 cursor-pointer" onclick={() => {
                    currentPreset.dwSchema = defaultPacketSchema()
                }}>{language.packetSchemaReset}</button>
            </div>

            {#each currentPreset.dwSchema ?? [] as row, i}
                <div class="flex flex-col border border-darkborderc rounded-md p-2 mt-2 gap-1">
                    <div class="flex items-center gap-2">
                        <span class="text-textcolor2 text-xs shrink-0">{language.packetSchemaHeader}</span>
                        <TextInput bind:value={currentPreset.dwSchema[i].name} size="sm"/>
                        <button class="text-textcolor2 hover:text-textcolor cursor-pointer shrink-0 disabled:opacity-30" disabled={i === 0} onclick={() => moveSchemaRow(i, -1)} aria-label="move up"><ChevronUpIcon size={16}/></button>
                        <button class="text-textcolor2 hover:text-textcolor cursor-pointer shrink-0 disabled:opacity-30" disabled={i === (currentPreset.dwSchema?.length ?? 0) - 1} onclick={() => moveSchemaRow(i, 1)} aria-label="move down"><ChevronDownIcon size={16}/></button>
                        <button class="text-textcolor2 hover:text-draculared cursor-pointer shrink-0" onclick={() => {
                            currentPreset.dwSchema = (currentPreset.dwSchema ?? []).filter((_, j) => j !== i)
                        }} aria-label="remove"><TrashIcon size={16}/></button>
                    </div>
                    <TextAreaInput bind:value={currentPreset.dwSchema[i].description} placeholder={language.packetSchemaDescription}/>
                    <Check bind:check={currentPreset.dwSchema[i].required} name={language.packetSchemaRequired}/>
                </div>
            {/each}

            <button class="font-medium cursor-pointer hover:text-green-500 mt-2 self-start" onclick={() => {
                const rows = currentPreset.dwSchema ?? []
                rows.push({ name: '', description: '', required: false })
                currentPreset.dwSchema = rows
            }} aria-label="add"><PlusIcon /></button>
        {:else if currentRole === 'writer'}
            <span class="text-textcolor mt-4">{language.writerRolePrompt}</span>
            <TextAreaInput bind:value={currentPreset.dwPrompt} placeholder={defaultWriterPrompt}/>
        {/if}
    </Accordion>
{/if}
