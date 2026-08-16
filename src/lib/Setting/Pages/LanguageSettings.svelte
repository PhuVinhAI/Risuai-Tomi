<script lang="ts">
    import { languageSettingsItems } from "src/ts/setting/languageSettingsData.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";
    import CharacterTranslationSettings from "./Language/CharacterTranslationSettings.svelte";
</script>

<CharacterTranslationSettings />
<SettingRenderer items={languageSettingsItems} />
