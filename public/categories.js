// =====================================
// CATÉGORIES DE MEMBRES (calculées automatiquement)
// =====================================
(function () {
    function age(membre) {
        const naissance = new Date(membre.date_naissance);
        if (!membre.date_naissance || isNaN(naissance)) return null;
        const auj = new Date();
        let a = auj.getFullYear() - naissance.getFullYear();
        if (auj < new Date(auj.getFullYear(), naissance.getMonth(), naissance.getDate())) a--;
        return a;
    }

    const CATEGORIES = [
        { code: "hommes",  libelle: "Hommes",                   test: m => m.sexe === "Masculin" },
        { code: "femmes",  libelle: "Femmes",                   test: m => m.sexe === "Féminin" },
        { code: "enfants", libelle: "Enfants (moins de 18 ans)", test: m => { const a = age(m); return a !== null && a < 18; } },
        { code: "jeunes",  libelle: "Jeunes (18 à 35 ans)",      test: m => { const a = age(m); return a !== null && a >= 18 && a <= 35; } },
        { code: "adultes", libelle: "Adultes (plus de 35 ans)",  test: m => { const a = age(m); return a !== null && a > 35; } },
        { code: "bureau",  libelle: "Membres du bureau",         test: (m, bureauIds) => bureauIds.includes(String(m.id)) }
    ];

    // Sans catégorie choisie : tous les membres sont concernés.
    window.CATEGORIES_FOGNY = CATEGORIES;
    window.membresConcernes = function (membres, codes, bureauIds) {
        if (!codes || !codes.length) return membres;
        const actives = CATEGORIES.filter(c => codes.includes(c.code));
        return membres.filter(m => actives.some(c => c.test(m, bureauIds || [])));
    };
})();
