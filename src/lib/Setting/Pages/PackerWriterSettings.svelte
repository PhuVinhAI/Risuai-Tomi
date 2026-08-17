<script lang="ts">
    import { language } from "src/lang";
    import PackerWriter from "./PackerWriter.svelte";
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.packerWriter}</h2>
<span class="text-textcolor2 text-sm mb-4">{language.packerWriterPageDesc}</span>

<PackerWriter />
