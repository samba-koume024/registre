// =====================================
// NIVEAUX DES COURS (Rawda, Section 1, 2, 3) : placement selon l'âge
// =====================================
(function () {
    window.NIVEAUX_FOGNY = [];

    window.ageMembre = function (membre) {
        const n = new Date(membre.date_naissance);
        if (!membre.date_naissance || isNaN(n)) return null;
        const auj = new Date();
        let age = auj.getFullYear() - n.getFullYear();
        if (auj < new Date(auj.getFullYear(), n.getMonth(), n.getDate())) age--;
        return age;
    };

    // Nom du niveau d'un membre, ou "" s'il n'a pas de date de naissance / hors tranches
    window.niveauDe = function (membre) {
        const age = window.ageMembre(membre);
        if (age === null) return "";
        const n = window.NIVEAUX_FOGNY.find(x => age >= x.age_min && age <= x.age_max);
        return n ? n.nom : "";
    };

    window.chargerNiveaux = async function () {
        try {
            const r = await fetch("/api/niveaux");
            if (!r.ok) return window.NIVEAUX_FOGNY;
            const d = await r.json();
            window.NIVEAUX_FOGNY = d.niveaux || [];
        } catch (e) { /* hors ligne ou non autorisé */ }
        return window.NIVEAUX_FOGNY;
    };
})();
