// Couleurs des graphiques en mode sombre (suit le réglage de l'appareil)
(function () {
    if (typeof Chart === "undefined" || !window.matchMedia) return;
    const appliquer = () => {
        const sombre = window.matchMedia("(prefers-color-scheme: dark)").matches;
        Chart.defaults.color = sombre ? "#cbd5e1" : "#666";
        Chart.defaults.borderColor = sombre ? "rgba(148, 163, 184, 0.25)" : "rgba(0, 0, 0, 0.1)";
    };
    appliquer();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", appliquer);
})();
