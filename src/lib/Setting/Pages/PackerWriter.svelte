<script lang="ts">
    import { language } from "src/lang";
    import { DBState } from "src/ts/stores.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import { PlusIcon, RefreshCwIcon } from "@lucide/svelte";
    import {
        createRolePreset,
        defaultPackerWriterSettings,
        listPresetsByRole,
        type PackerWriterRole,
    } from "src/ts/process/packerWriter";
    import {
        clearPackerWriterLog,
        downloadPackerWriterLog,
        getPackerWriterLogStats,
    } from "src/ts/process/packerWriterLog";
    import { alertNormal } from "src/ts/alert";
    import { onMount } from "svelte";

    let logStats = $state({ count: 0, bytes: 0 })

    DBState.db.packerWriter ??= { ...defaultPackerWriterSettings }

    const packerPresets = $derived(listPresetsByRole('packer'))
    const writerPresets = $derived(listPresetsByRole('writer'))

    function addRolePreset(role: PackerWriterRole) {
        const preset = createRolePreset(role)
        const existing = new Set((DBState.db.botPresets ?? []).map((item) => item?.name))
        let name = preset.name ?? role
        let suffix = 2
        while (existing.has(name)) {
            name = `${preset.name} ${suffix}`
            suffix++
        }
        preset.name = name
        DBState.db.botPresets = [...(DBState.db.botPresets ?? []), preset]
        if (role === 'packer') DBState.db.packerWriter.packerPreset = name
        else DBState.db.packerWriter.writerPreset = name
    }

    async function refreshLogStats() {
        logStats = await getPackerWriterLogStats()
    }

    onMount(() => { void refreshLogStats() })

    function formatBytes(bytes: number) {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }
</script>

<Check bind:check={DBState.db.packerWriter.enabled} name={language.packerWriterEnabled} className="mt-2"/>

{#if DBState.db.packerWriter.enabled}
    <span class="text-textcolor mt-4">{language.packerPreset}</span>
    {#if packerPresets.length === 0}
        <div class="flex items-center gap-2">
            <span class="text-draculared text-sm">{language.packerWriterNoPresets}</span>
            <button class="bg-selected text-textcolor p-2 rounded-md shrink-0" onclick={() => addRolePreset('packer')} aria-label={language.packerPreset}>
                <PlusIcon size={16}/>
            </button>
        </div>
    {:else}
        <SelectInput bind:value={DBState.db.packerWriter.packerPreset}>
            <OptionInput value="">---</OptionInput>
            {#each packerPresets as preset}<OptionInput value={preset.name}>{preset.name}</OptionInput>{/each}
        </SelectInput>
    {/if}

    <span class="text-textcolor mt-4">{language.writerPreset}</span>
    {#if writerPresets.length === 0}
        <div class="flex items-center gap-2">
            <span class="text-draculared text-sm">{language.packerWriterNoPresets}</span>
            <button class="bg-selected text-textcolor p-2 rounded-md shrink-0" onclick={() => addRolePreset('writer')} aria-label={language.writerPreset}>
                <PlusIcon size={16}/>
            </button>
        </div>
    {:else}
        <SelectInput bind:value={DBState.db.packerWriter.writerPreset}>
            <OptionInput value="">---</OptionInput>
            {#each writerPresets as preset}<OptionInput value={preset.name}>{preset.name}</OptionInput>{/each}
        </SelectInput>
    {/if}

    <span class="text-textcolor mt-4">{language.packerRerollMode}</span>
    <SelectInput bind:value={DBState.db.packerWriter.rerollMode}>
        <OptionInput value="writer">{language.packerRerollModeWriter}</OptionInput>
        <OptionInput value="both">{language.packerRerollModeBoth}</OptionInput>
    </SelectInput>

    <span class="text-textcolor mt-4">{language.packerWriterPacketCacheSize}</span>
    <NumberInput bind:value={DBState.db.packerWriter.packetCacheSize} min={1} max={500}/>

    <span class="text-textcolor mt-6 font-bold">{language.packerWriterLog}</span>
    <Check bind:check={DBState.db.packerWriter.logEnabled} name={language.packerWriterLogEnabled} className="mt-2"/>
    <span class="text-textcolor2 text-sm mt-2">{language.packerWriterLogWarning}</span>
    <span class="text-textcolor2 text-sm mt-2">{logStats.count} / {formatBytes(logStats.bytes)}</span>
    <div class="flex gap-2 mt-2">
        <button class="bg-selected text-textcolor p-2 rounded-md text-sm" onclick={async () => {
            const ok = await downloadPackerWriterLog()
            if(!ok) alertNormal(language.packerWriterLogEmpty)
            await refreshLogStats()
        }}>{language.packerWriterLogDownload}</button>
        <button class="bg-red-500 text-white p-2 rounded-md text-sm" onclick={async () => {
            await clearPackerWriterLog()
            await refreshLogStats()
        }}>{language.packerWriterLogClear}</button>
        <button class="bg-selected text-textcolor p-2 rounded-md" onclick={refreshLogStats} aria-label="refresh">
            <RefreshCwIcon size={16}/>
        </button>
    </div>
{/if}
