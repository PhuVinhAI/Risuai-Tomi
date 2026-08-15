<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import { PlusIcon } from "@lucide/svelte";
    import {
        createRolePreset,
        defaultDirectorWriterSettings,
        listPresetsByRole,
        type DirectorWriterRole,
    } from "src/ts/process/directorWriter";
    import {
        clearDirectorWriterLog,
        downloadDirectorWriterLog,
        getDirectorWriterLogStats,
    } from "src/ts/process/directorWriterLog";
    import { alertNormal } from "src/ts/alert";
    import { onMount } from "svelte";

    let logStats = $state({ count: 0, bytes: 0 })

    DBState.db.directorWriter ??= { ...defaultDirectorWriterSettings }

    const directorPresets = $derived(listPresetsByRole('director'))
    const writerPresets = $derived(listPresetsByRole('writer'))

    function addRolePreset(role: DirectorWriterRole) {
        const preset = createRolePreset(role)
        const existing = new Set((DBState.db.botPresets ?? []).map((p) => p?.name))
        let name = preset.name ?? role
        let suffix = 2
        while (existing.has(name)) {
            name = `${preset.name} ${suffix}`
            suffix++
        }
        preset.name = name
        DBState.db.botPresets = [...(DBState.db.botPresets ?? []), preset]
        if (role === 'director') {
            DBState.db.directorWriter.directorPreset = name
        }
        else {
            DBState.db.directorWriter.writerPreset = name
        }
    }

    async function refreshLogStats() {
        logStats = await getDirectorWriterLogStats()
    }

    onMount(() => {
        void refreshLogStats()
    })

    function formatBytes(bytes: number) {
        if (bytes < 1024) {
            return `${bytes} B`
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`
        }
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }
</script>

<Check bind:check={DBState.db.directorWriter.enabled} name={language.directorWriterEnabled} className="mt-2"/>

{#if DBState.db.directorWriter.enabled}
    <span class="text-textcolor mt-4">{language.directorPreset}</span>
    {#if directorPresets.length === 0}
        <div class="flex items-center gap-2">
            <span class="text-draculared text-sm">{language.directorWriterNoPresets}</span>
            <button class="bg-selected text-textcolor px-2 py-1 rounded-md text-sm shrink-0" onclick={() => addRolePreset('director')}>
                <PlusIcon size={14}/>
            </button>
        </div>
    {:else}
        <SelectInput bind:value={DBState.db.directorWriter.directorPreset}>
            <OptionInput value="">---</OptionInput>
            {#each directorPresets as preset}
                <OptionInput value={preset.name}>{preset.name}</OptionInput>
            {/each}
        </SelectInput>
    {/if}

    <span class="text-textcolor mt-4">{language.writerPreset}</span>
    {#if writerPresets.length === 0}
        <div class="flex items-center gap-2">
            <span class="text-draculared text-sm">{language.directorWriterNoPresets}</span>
            <button class="bg-selected text-textcolor px-2 py-1 rounded-md text-sm shrink-0" onclick={() => addRolePreset('writer')}>
                <PlusIcon size={14}/>
            </button>
        </div>
    {:else}
        <SelectInput bind:value={DBState.db.directorWriter.writerPreset}>
            <OptionInput value="">---</OptionInput>
            {#each writerPresets as preset}
                <OptionInput value={preset.name}>{preset.name}</OptionInput>
            {/each}
        </SelectInput>
    {/if}

    <span class="text-textcolor mt-4">{language.directorRerollMode}</span>
    <SelectInput bind:value={DBState.db.directorWriter.rerollMode}>
        <OptionInput value="writer">{language.directorRerollModeWriter}</OptionInput>
        <OptionInput value="both">{language.directorRerollModeBoth}</OptionInput>
    </SelectInput>

    <span class="text-textcolor mt-4">{language.directorWriterPacketCacheSize}</span>
    <NumberInput bind:value={DBState.db.directorWriter.packetCacheSize} min={1} max={500}/>

    <span class="text-textcolor mt-6 font-bold">{language.directorWriterLog}</span>
    <Check bind:check={DBState.db.directorWriter.logEnabled} name={language.directorWriterLogEnabled} className="mt-2"/>
    <span class="text-textcolor2 text-sm mt-2">{language.directorWriterLogWarning}</span>
    <span class="text-textcolor2 text-sm mt-2">{logStats.count} / {formatBytes(logStats.bytes)}</span>
    <div class="flex gap-2 mt-2">
        <button class="bg-selected text-textcolor p-2 rounded-md text-sm" onclick={async () => {
            const ok = await downloadDirectorWriterLog()
            if(!ok){
                alertNormal(language.directorWriterLogEmpty)
            }
            await refreshLogStats()
        }}>{language.directorWriterLogDownload}</button>
        <button class="bg-red-500 text-white p-2 rounded-md text-sm" onclick={async () => {
            await clearDirectorWriterLog()
            await refreshLogStats()
        }}>{language.directorWriterLogClear}</button>
        <button class="bg-selected text-textcolor p-2 rounded-md text-sm" onclick={refreshLogStats}>↻</button>
    </div>
{/if}
