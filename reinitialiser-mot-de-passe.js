require("dotenv").config();
const bcrypt = require("bcryptjs");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Nouveau mot de passe : ", async (motDePasse) => {
  try {
    if (!motDePasse || motDePasse.length < 8) {
      throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
    }

    const hash = await bcrypt.hash(motDePasse, 12);

    const { data, error } = await supabase
      .from("comptes_membres")
      .update({ mot_de_passe_hash: hash })
      .eq("membre_id", 6)
      .select("id, membre_id");

    if (error) throw error;
    if (!data || data.length !== 1) {
      throw new Error("Compte introuvable ou résultat inattendu.");
    }

    console.log("Mot de passe réinitialisé avec succès.");
  } catch (erreur) {
    console.error("Erreur :", erreur.message);
  } finally {
    rl.close();
  }
});