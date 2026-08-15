<script lang="ts">
    import { language } from "src/lang";
    import DirectorWriter from "./DirectorWriter.svelte";
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.directorWriter}</h2>
<span class="text-textcolor2 text-sm mb-4">{language.directorWriterPageDesc}</span>

<DirectorWriter />
