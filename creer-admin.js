require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const readline = require("readline");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question("Choisis ton identifiant administrateur : ", (identifiant) => {
    rl.question("Choisis ton mot de passe : ", async (motDePasse) => {
        try {
            if (!identifiant.trim() || motDePasse.length < 10) {
                console.log("Identifiant obligatoire et mot de passe de 10 caractères minimum.");
                rl.close();
                return;
            }

            const hash = await bcrypt.hash(motDePasse, 12);

            const { error } = await supabase
                .from("administrateurs")
                .insert([{
                    identifiant: identifiant.trim(),
                    mot_de_passe_hash: hash
                }]);

            if (error) {
                console.error("Erreur :", error.message);
            } else {
                console.log("Compte administrateur créé avec succès !");
            }
        } catch (erreur) {
            console.error("Une erreur est survenue :", erreur.message);
        } finally {
            rl.close();
        }
    });
});