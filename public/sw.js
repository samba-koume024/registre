// Registre Fogny : service worker (installation + mode hors ligne complet)
// - Les pages et les données déjà consultées restent disponibles sans connexion.
// - Les modifications faites hors ligne sont gardées sur l'appareil, affichées tout de suite,
//   puis envoyées automatiquement dès que la connexion revient.
// Changer le numéro de version ci-dessous force la mise à jour des fichiers en cache.
const VERSION = "fogny-v12";
const FICHIERS = [
    "/style.css", "/theme-pro.css", "/police.css", "/app.js", "/acces.js", "/pointages.js", "/supervisions.js",
    "/rapports.js", "/reunions.js", "/categories.js", "/programme-categories.js",
    "/membres-liste.js", "/theme-sombre.js", "/entete.js", "/logo.jpg", "/niveaux.js", "/cours.js", "/membres-import.js", "/comptes.js", "/droits.js", "/profil.js", "/pwa.js", "/manifest.webmanifest",
    "/icons/icon-192.png", "/icons/icon-512.png"
];
const BIBLIOTHEQUES = [
    "https://cdn.jsdelivr.net/npm/chart.js",
    "https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2",
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
];

// Modifications qui peuvent être faites hors ligne (saisie de données uniquement).
// Les comptes, mots de passe, rôles et permissions exigent toujours la connexion.
const ECRITURES_HORS_LIGNE = [
    /^\/api\/membres(\/import)?$/,
    /^\/api\/membres\/[^/]+$/,
    /^\/api\/programme(\/[^/]+)?$/,
    /^\/api\/programme\/[^/]+\/categories$/,
    /^\/api\/pointages$/,
    /^\/api\/pointage-infos$/,
    /^\/api\/reunions(\/[^/]+)?$/,
    /^\/api\/evaluations(\/[^/]+)?$/,
    /^\/api\/evaluations\/[^/]+\/notes$/,
    /^\/api\/cours\/[^/]+$/,
    /^\/api\/bureau(\/[^/]+)?$/
];

// ---------------------------------------------------------------------------
// Installation et nettoyage
// ---------------------------------------------------------------------------
self.addEventListener("install", evenement => {
    evenement.waitUntil((async () => {
        const cache = await caches.open(VERSION);
        await Promise.all(FICHIERS.map(u => cache.add(u).catch(() => {})));
        await Promise.all(BIBLIOTHEQUES.map(u =>
            fetch(u, { mode: "no-cors" }).then(r => cache.put(u, r)).catch(() => {})));
        self.skipWaiting();
    })());
});

self.addEventListener("activate", evenement => {
    evenement.waitUntil((async () => {
        const noms = await caches.keys();
        await Promise.all(noms.filter(n => n !== VERSION).map(n => caches.delete(n)));
        await self.clients.claim();
        await rejouer();
    })());
});

// ---------------------------------------------------------------------------
// File d'attente des modifications (IndexedDB)
// ---------------------------------------------------------------------------
function ouvrirBase() {
    return new Promise((ok, ko) => {
        const r = indexedDB.open("fogny-hors-ligne", 1);
        r.onupgradeneeded = () => {
            r.result.createObjectStore("file", { keyPath: "id", autoIncrement: true });
            r.result.createObjectStore("echecs", { keyPath: "id", autoIncrement: true });
        };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
    });
}

async function operationBase(magasin, mode, action) {
    const base = await ouvrirBase();
    return new Promise((ok, ko) => {
        const t = base.transaction(magasin, mode);
        const requete = action(t.objectStore(magasin));
        t.oncomplete = () => { base.close(); ok(requete ? requete.result : undefined); };
        t.onerror = () => { base.close(); ko(t.error); };
        t.onabort = () => { base.close(); ko(t.error); };
    });
}

const lireFile = () => operationBase("file", "readonly", s => s.getAll());
const ajouterFile = element => operationBase("file", "readwrite", s => s.add(element));
const majFile = element => operationBase("file", "readwrite", s => s.put(element));
const supprimerFile = id => operationBase("file", "readwrite", s => s.delete(id));
const lireEchecs = () => operationBase("echecs", "readonly", s => s.getAll());
const ajouterEchec = element => operationBase("echecs", "readwrite", s => s.add(element));
const viderMagasin = nom => operationBase(nom, "readwrite", s => s.clear());

async function diffuser(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage(message));
}

async function diffuserEtat(extra = {}) {
    try {
        const [file, echecs] = await Promise.all([lireFile(), lireEchecs()]);
        await diffuser({ type: "etat", restants: file.length, echecs, ...extra });
    } catch (e) { /* ignoré */ }
}

// ---------------------------------------------------------------------------
// Envoi automatique des modifications en attente
// ---------------------------------------------------------------------------
let promesseRejeu = null;

// Un seul envoi à la fois : les appels simultanés attendent le même envoi
function rejouer() {
    if (!promesseRejeu) {
        promesseRejeu = executerRejeu().finally(() => { promesseRejeu = null; });
    }
    return promesseRejeu;
}

async function executerRejeu() {
    let envoyes = 0;
    let connexionRequise = false;
    try {
        const file = await lireFile();
        for (const element of file) {
            let reponse;
            try {
                reponse = await fetch(element.url, {
                    method: element.methode,
                    headers: { "Content-Type": "application/json" },
                    body: element.methode === "DELETE" ? undefined : element.corps,
                    credentials: "same-origin"
                });
            } catch (e) {
                break;                          // pas de réseau : on réessaiera
            }
            if (reponse.status === 401) { connexionRequise = true; break; }
            if (reponse.ok) {
                await supprimerFile(element.id);
                envoyes++;
            } else if (reponse.status >= 500 || reponse.status === 429) {
                break;                          // serveur occupé : on réessaiera
            } else {
                let message = "Refusé par le serveur.";
                try { message = (await reponse.json()).message || message; } catch (e) { /* ignoré */ }
                await ajouterEchec({ url: element.url, methode: element.methode, message, date: element.date });
                await supprimerFile(element.id);
            }
        }
    } catch (e) {
        console.error("Synchronisation :", e);
    }
    await diffuserEtat({ envoyes, connexionRequise });
}

async function rejouerSiNecessaire() {
    try {
        if ((await lireFile()).length) await rejouer();
    } catch (e) { /* ignoré */ }
}

self.addEventListener("sync", evenement => {
    if (evenement.tag === "fogny-synchro") evenement.waitUntil(rejouer());
});

self.addEventListener("message", evenement => {
    const d = evenement.data || {};
    if (d.type === "rejouer") evenement.waitUntil(rejouer());
    else if (d.type === "etat") evenement.waitUntil(diffuserEtat());
    else if (d.type === "vider-echecs") evenement.waitUntil(viderMagasin("echecs").then(() => diffuserEtat()));
    else if (d.type === "deconnexion") {
        evenement.waitUntil((async () => {
            await rejouer();
            await viderMagasin("file");
            await viderMagasin("echecs");
            await diffuserEtat();
        })());
    }
});

// ---------------------------------------------------------------------------
// Mise à jour immédiate des données affichées (copie locale)
// ---------------------------------------------------------------------------
const aujourdhui = () => new Date().toLocaleDateString("fr-CA");
const arrondi = n => Math.round(n * 100) / 100;

async function majCache(transformation) {
    const cache = await caches.open(VERSION);
    for (const requete of await cache.keys()) {
        const url = new URL(requete.url);
        if (!url.pathname.startsWith("/api/")) continue;
        const reponse = await cache.match(requete);
        if (!reponse) continue;
        let donnees;
        try { donnees = await reponse.clone().json(); } catch (e) { continue; }
        const nouveau = transformation(url, donnees);
        if (nouveau !== undefined) {
            await cache.put(requete, new Response(JSON.stringify(nouveau),
                { status: 200, headers: { "Content-Type": "application/json" } }));
        }
    }
}

async function lireCache(chemin) {
    const cache = await caches.open(VERSION);
    for (const requete of await cache.keys()) {
        if (new URL(requete.url).pathname === chemin) {
            try { return await (await cache.match(requete)).clone().json(); } catch (e) { return null; }
        }
    }
    return null;
}

async function ecrireCache(chemin, donnees) {
    const cache = await caches.open(VERSION);
    await cache.put(new Request(self.location.origin + chemin),
        new Response(JSON.stringify(donnees), { status: 200, headers: { "Content-Type": "application/json" } }));
}

const effectifsPresence = parts => ({
    presents: parts.filter(p => p.presence !== "Absent" && p.presence !== "Excusé").length,
    absents: parts.filter(p => p.presence === "Absent").length,
    excuses: parts.filter(p => p.presence === "Excusé").length
});

function statistiquesNotes(notes) {
    const valeurs = notes.map(n => Number(n.note));
    if (!valeurs.length) return { nb_notes: 0, moyenne: null, reussite: null };
    return {
        nb_notes: valeurs.length,
        moyenne: arrondi(valeurs.reduce((t, v) => t + v, 0) / valeurs.length),
        reussite: Math.round(valeurs.filter(v => v >= 10).length / valeurs.length * 100)
    };
}

async function patcherCache(methode, chemin, c, tmpId) {
    let m;
    const memeId = id => x => String(x.id) === id;

    // ----- Membres -----
    if (chemin === "/api/membres" && methode === "POST") {
        return majCache((u, d) => u.pathname === "/api/membres" && Array.isArray(d)
            ? [...d, { id: tmpId, ...c, date_inscription: aujourdhui() }] : undefined);
    }
    if (chemin === "/api/membres/import") {
        return majCache((u, d) => u.pathname === "/api/membres" && Array.isArray(d)
            ? [...d, ...(c.membres || []).map((x, i) => ({ id: `${tmpId}-${i}`, ...x, date_inscription: aujourdhui() }))]
            : undefined);
    }
    if ((m = chemin.match(/^\/api\/membres\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => {
            if (u.pathname !== "/api/membres" || !Array.isArray(d)) return undefined;
            return methode === "DELETE" ? d.filter(x => String(x.id) !== id)
                : d.map(x => memeId(id)(x) ? { ...x, ...c } : x);
        });
    }

    // ----- Programme -----
    if (chemin === "/api/programme" && methode === "POST") {
        return majCache((u, d) => u.pathname === "/api/programme" && Array.isArray(d)
            ? [...d, { id: tmpId, ...c }] : undefined);
    }
    if ((m = chemin.match(/^\/api\/programme\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => {
            if (u.pathname !== "/api/programme" || !Array.isArray(d)) return undefined;
            return methode === "DELETE" ? d.filter(x => String(x.id) !== id)
                : d.map(x => memeId(id)(x) ? { ...x, ...c } : x);
        });
    }
    if ((m = chemin.match(/^\/api\/programme\/([^/]+)\/categories$/))) {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => u.pathname === "/api/programme-categories" && Array.isArray(d.liens)
            ? { ...d, liens: [...d.liens.filter(l => String(l.programme_id) !== id),
                ...(c.categories || []).map(categorie => ({ programme_id: id, categorie }))] } : undefined);
    }

    // ----- Pointages et informations de séance -----
    if (chemin === "/api/pointages") {
        return majCache((u, d) => {
            if (u.pathname !== "/api/pointages" || !Array.isArray(d.pointages)) return undefined;
            if (u.searchParams.get("date") !== c.date || (u.searchParams.get("activite") || "") !== (c.activite || "")) return undefined;
            const parMembre = new Map(d.pointages.map(p => [String(p.membre_id), p]));
            (c.pointages || []).forEach(p => {
                const ancien = parMembre.get(String(p.membre_id)) || {};
                parMembre.set(String(p.membre_id), { ...ancien, membre_id: p.membre_id, statut: p.statut });
            });
            return { ...d, pointages: [...parMembre.values()] };
        });
    }
    if (chemin === "/api/pointage-infos") {
        return majCache((u, d) => {
            if (u.pathname !== "/api/pointage-infos") return undefined;
            if (u.searchParams.get("date") !== c.date || (u.searchParams.get("activite") || "") !== (c.activite || "")) return undefined;
            return { ...d, info: { lieu: c.lieu || null, informations: c.informations || null, date_maj: new Date().toISOString() } };
        });
    }

    // ----- Réunions -----
    if (chemin === "/api/reunions" && methode === "POST") {
        const element = {
            id: tmpId, titre: c.titre, date_reunion: c.date_reunion, heure: c.heure || null,
            lieu: c.lieu || null, statut: c.statut || "Prévue", ...effectifsPresence(c.participants || [])
        };
        await majCache((u, d) => u.pathname === "/api/reunions" && Array.isArray(d.reunions)
            ? { ...d, reunions: [...d.reunions, element] } : undefined);
        await ecrireCache(`/api/reunions/${tmpId}`, {
            succes: true,
            reunion: { ...element, ordre_du_jour: c.ordre_du_jour || null, proces_verbal: c.proces_verbal || null },
            participants: c.participants || []
        });
        return;
    }
    if ((m = chemin.match(/^\/api\/reunions\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (methode === "DELETE") {
            await majCache((u, d) => u.pathname === "/api/reunions" && Array.isArray(d.reunions)
                ? { ...d, reunions: d.reunions.filter(x => String(x.id) !== id) } : undefined);
            const cache = await caches.open(VERSION);
            for (const requete of await cache.keys()) {
                if (new URL(requete.url).pathname === `/api/reunions/${id}`) await cache.delete(requete);
            }
            return;
        }
        return majCache((u, d) => {
            if (u.pathname === "/api/reunions" && Array.isArray(d.reunions)) {
                return { ...d, reunions: d.reunions.map(x => memeId(id)(x) ? {
                    ...x, titre: c.titre, date_reunion: c.date_reunion, heure: c.heure || null,
                    lieu: c.lieu || null, statut: c.statut || x.statut, ...effectifsPresence(c.participants || [])
                } : x) };
            }
            if (u.pathname === `/api/reunions/${id}` && d.reunion) {
                return { ...d, reunion: { ...d.reunion, titre: c.titre, date_reunion: c.date_reunion,
                    heure: c.heure || null, lieu: c.lieu || null, statut: c.statut || d.reunion.statut,
                    ordre_du_jour: c.ordre_du_jour || null, proces_verbal: c.proces_verbal || null },
                    participants: c.participants || [] };
            }
            return undefined;
        });
    }

    // ----- Évaluations et notes -----
    if (chemin === "/api/evaluations" && methode === "POST") {
        return majCache((u, d) => {
            if (u.pathname !== "/api/evaluations" || !Array.isArray(d.evaluations)) return undefined;
            if (u.searchParams.get("programme_id") !== String(c.programme_id) || u.searchParams.get("niveau") !== c.niveau) return undefined;
            return { ...d, evaluations: [...d.evaluations, {
                id: tmpId, programme_id: c.programme_id, niveau: c.niveau, titre: c.titre,
                date_evaluation: c.date_evaluation, notes: [], nb_notes: 0, moyenne: null, reussite: null
            }] };
        });
    }
    if ((m = chemin.match(/^\/api\/evaluations\/([^/]+)\/notes$/))) {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => {
            if (u.pathname !== "/api/evaluations" || !Array.isArray(d.evaluations)) return undefined;
            if (!d.evaluations.some(memeId(id))) return undefined;
            return { ...d, evaluations: d.evaluations.map(e => {
                if (String(e.id) !== id) return e;
                const parMembre = new Map((e.notes || []).map(n => [String(n.membre_id), n]));
                (c.notes || []).forEach(n => {
                    if (n.note === null || n.note === "" || n.note === undefined) parMembre.delete(String(n.membre_id));
                    else parMembre.set(String(n.membre_id), { membre_id: n.membre_id, note: Number(n.note) });
                });
                const notes = [...parMembre.values()];
                return { ...e, notes, ...statistiquesNotes(notes) };
            }) };
        });
    }
    if ((m = chemin.match(/^\/api\/evaluations\/([^/]+)$/)) && methode === "DELETE") {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => u.pathname === "/api/evaluations" && Array.isArray(d.evaluations)
            ? { ...d, evaluations: d.evaluations.filter(e => String(e.id) !== id) } : undefined);
    }

    // ----- Cours -----
    if ((m = chemin.match(/^\/api\/cours\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => {
            if (u.pathname !== "/api/cours" || !Array.isArray(d.cours)) return undefined;
            const sans = d.cours.filter(x => String(x.programme_id) !== id);
            return { ...d, cours: methode === "DELETE" ? sans : [...sans, { programme_id: id }] };
        });
    }

    // ----- Bureau -----
    if (chemin === "/api/bureau" && methode === "POST") {
        const membres = (await lireCache("/api/membres")) || [];
        const membre = membres.find(x => String(x.id) === String(c.membre_id)) || null;
        return majCache((u, d) => u.pathname === "/api/bureau" && Array.isArray(d.bureau)
            ? { ...d, bureau: [...d.bureau, { id: tmpId, membre_id: c.membre_id, fonction: c.fonction,
                date_attribution: aujourdhui(), membres: membre }] } : undefined);
    }
    if ((m = chemin.match(/^\/api\/bureau\/([^/]+)$/)) && methode === "DELETE") {
        const id = decodeURIComponent(m[1]);
        return majCache((u, d) => u.pathname === "/api/bureau" && Array.isArray(d.bureau)
            ? { ...d, bureau: d.bureau.filter(x => String(x.id) !== id) } : undefined);
    }
}

// Modifier ou supprimer un élément créé hors ligne et pas encore envoyé :
// on fusionne avec la création en attente au lieu d'envoyer deux requêtes.
async function compacter(methode, chemin, corps) {
    const m = chemin.match(/^\/api\/(?:membres|programme|reunions|bureau|evaluations)\/(hors-ligne-[^/]+)$/);
    if (!m) return false;
    const file = await lireFile();
    const creation = file.find(e => e.tmpId === m[1]);
    if (!creation) return false;
    if (methode === "DELETE") { await supprimerFile(creation.id); return true; }
    if (methode === "PUT") {
        creation.corps = JSON.stringify({ ...JSON.parse(creation.corps), ...JSON.parse(corps || "{}") });
        await majFile(creation);
        return true;
    }
    return false;
}

async function mettreEnAttente(requete, chemin) {
    const methode = requete.method;
    const corps = methode === "DELETE" ? "" : await requete.clone().text();
    let c = {};
    try { c = corps ? JSON.parse(corps) : {}; } catch (e) { /* corps non JSON */ }

    const tmpId = methode === "POST" ? `hors-ligne-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : null;

    const fusionne = await compacter(methode, chemin, corps);
    if (!fusionne) {
        await ajouterFile({ url: requete.url, methode, corps, tmpId, date: new Date().toISOString() });
    }
    try { await patcherCache(methode, chemin, c, tmpId); } catch (e) { console.error("Copie locale :", e); }

    if (self.registration && self.registration.sync) {
        self.registration.sync.register("fogny-synchro").catch(() => {});
    }
    await diffuserEtat({ mis_en_attente: true });

    return new Response(JSON.stringify({
        succes: true,
        hors_ligne: true,
        id: tmpId,
        message: "Hors ligne : modification enregistrée sur cet appareil. Elle sera envoyée automatiquement dès le retour de la connexion."
    }), { status: 202, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Réponses aux requêtes
// ---------------------------------------------------------------------------
const reponseHorsLigne = () => new Response(
    JSON.stringify({ succes: false, message: "Hors ligne : ces données n'ont pas encore été chargées sur cet appareil." }),
    { status: 503, headers: { "Content-Type": "application/json" } });

async function reseauPuisCache(requete, cleCache) {
    const cache = await caches.open(VERSION);
    try {
        const reponse = await fetch(requete);
        if (reponse.ok && !reponse.redirected) cache.put(cleCache || requete, reponse.clone());
        return reponse;
    } catch (e) {
        return (await cache.match(cleCache || requete)) || null;
    }
}

self.addEventListener("fetch", evenement => {
    const requete = evenement.request;
    const url = new URL(requete.url);

    // Modifications : envoi normal ; si le réseau est absent, on garde la modification
    if (requete.method !== "GET") {
        if (url.origin === location.origin && ["POST", "PUT", "DELETE"].includes(requete.method)
            && ECRITURES_HORS_LIGNE.some(motif => motif.test(url.pathname))) {
            evenement.respondWith((async () => {
                try {
                    return await fetch(requete.clone());
                } catch (e) {
                    return mettreEnAttente(requete, url.pathname);
                }
            })());
        }
        return;
    }

    // Bibliothèques externes : cache d'abord
    if (url.origin !== location.origin) {
        if (BIBLIOTHEQUES.includes(requete.url)) {
            evenement.respondWith(caches.match(requete.url).then(c => c || fetch(requete)));
        }
        return;
    }

    // Données : réseau d'abord, dernière copie en secours.
    // Avant de lire les données du serveur, on envoie les modifications en attente,
    // pour que l'affichage contienne bien ce qui a été fait hors ligne.
    if (url.pathname.startsWith("/api/")) {
        evenement.respondWith((async () => {
            if (self.navigator && self.navigator.onLine !== false) await rejouerSiNecessaire();
            return (await reseauPuisCache(requete)) || reponseHorsLigne();
        })());
        return;
    }

    // Pages : réseau d'abord, page enregistrée en secours
    if (requete.mode === "navigate") {
        evenement.respondWith((async () => {
            const r = await reseauPuisCache(requete, url.pathname);
            return r || (await caches.match("/")) || Response.error();
        })());
        return;
    }

    // Fichiers de l'application : dernière version en ligne, copie en cache hors ligne
    evenement.respondWith((async () => {
        const cache = await caches.open(VERSION);
        try {
            const reponse = await fetch(requete);
            if (reponse.ok) cache.put(requete, reponse.clone());
            return reponse;
        } catch (e) {
            return (await cache.match(requete)) || Response.error();
        }
    })());
});
