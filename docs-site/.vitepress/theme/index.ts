import DefaultTheme from "vitepress/theme-without-fonts";
import { h } from "vue";
import ResultCard from "./ResultCard.vue";
import TryIt from "./TryIt.vue";
import Verdict from "./Verdict.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  // The home hero shows a result card instead of a logo.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "home-hero-image": () => h(ResultCard)
    }),
  enhanceApp({ app }) {
    app.component("Verdict", Verdict);
    app.component("TryIt", TryIt);
    app.component("ResultCard", ResultCard);
  }
};
