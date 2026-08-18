<script lang="ts">
    import { language } from "src/lang";
    import ResponseTransformer from "./ResponseTransformer.svelte";
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.responseTransformer}</h2>
<span class="text-textcolor2 text-sm mb-4">{language.responseTransformerPageDesc}</span>

<ResponseTransformer />
