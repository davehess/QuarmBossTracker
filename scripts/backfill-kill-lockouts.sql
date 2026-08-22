-- One-shot backfill: character_lockouts from kills we already have parses for.
--
-- Hitya 2026-08-22: "taeya reported this Ventani kill so they should have a
-- lockout." The table shipped reading only /sll relays and had never held a
-- row, while `encounters` already carried the kills. This walks the history
-- the live ingest path (index.js `_recordKillLockouts`) will handle from now
-- on, so the officer surfaces are useful for the NEXT raid rather than the
-- one after it.
--
-- Safe to re-run: it only writes lockouts that have not expired, and it never
-- overwrites a live /sll row (the server's own remaining time beats a number
-- computed off the boss timer).
--
-- Boss list is generated from data/bosses.json — npc id from pqdiUrl, plus the
-- curated timer. Regenerate with scripts/gen-boss-values.js if bosses change.
WITH boss(npc_id, boss_key, boss_name, timer_hours) AS (VALUES
  (32040, 'lord_nagafen', 'Lord Nagafen', 162),
  (32000, 'magi_rokyl', 'Magi Rokyl', 18),
  (32020, 'warlord_skarlon', 'Warlord Skarlon', 18),
  (32022, 'king_tranix', 'King Tranix', 18),
  (73057, 'lady_vox', 'Lady Vox', 162),
  (64001, 'phinigel_autropos', 'Phinigel Autropos', 18),
  (72003, 'cazic_thule', 'Cazic Thule', 162),
  (72090, 'dracoliche', 'a dracoliche', 66),
  (72004, 'fright', 'Fright', 18),
  (72000, 'dread', 'Dread', 18),
  (72002, 'terror', 'Terror', 18),
  (76600, 'innoruuk', 'Innoruuk', 162),
  (76611, 'maestro_of_rancor', 'Maestro of Rancor', 66),
  (76325, 'lord_of_ire', 'Lord of Ire', 66),
  (76051, 'ashenbone_broodmaster', 'Ashenbone Broodmaster', 66),
  (89154, 'trakanon', 'Trakanon', 66),
  (102010, 'venril_sathir', 'Venril Sathir', 66),
  (105002, 'drusella_sathir', 'Drusella Sathir', 66),
  (39138, 'master_yael', 'Master Yael', 66),
  (39648, 'nortlav_scalekeeper', 'Nortlav the Scalekeeper', 66),
  (91093, 'talendor', 'Talendor', 66),
  (94002, 'severilous', 'Severilous', 66),
  (96089, 'faydedar', 'Faydedar', 66),
  (108510, 'phara_dar', 'Phara Dar', 66),
  (108513, 'nexona', 'Nexona', 66),
  (108517, 'hoshkar', 'Hoshkar', 66),
  (108509, 'silverwing', 'Silverwing', 66),
  (108511, 'xygoz', 'Xygoz', 66),
  (108512, 'druushk', 'Druushk', 66),
  (103056, 'overking_bathezid', 'Overking Bathezid', 18),
  (103055, 'queen_velazul_dizok', 'Queen Velazul Di`zok', 18),
  (103080, 'prince_selrach_dizok', 'Prince Selrach Di`zok', 18),
  (112025, 'velketor_the_sorcerer', 'Velketor the Sorcerer', 66),
  (112049, 'lord_doljonijiarnimorinar', 'Lord Doljonijiarnimorinar', 72),
  (127002, 'tunare', 'Tunare', 162),
  (127022, 'grahl_strongback', 'Grahl Strongback', 30),
  (127017, 'sarik_the_fang', 'Sarik the Fang', 30),
  (127023, 'galiel_spirithoof', 'Galiel Spirithoof', 30),
  (113215, 'king_tormax', 'King Tormax', 162),
  (113244, 'avatar_of_war', 'The Avatar of War', 162),
  (113118, 'derakor_vindicator', 'Derakor the Vindicator', 66),
  (113000, 'statue_of_rallos_zek', 'The Statue of Rallos Zek', 162),
  (129003, 'dain_frostreaver', 'Dain Frostreaver IV', 162),
  (129021, 'royal_scribe_kaavin', 'Royal Scribe Kaavin', 66),
  (114618, 'lord_yelinak', 'Lord Yelinak', 162),
  (110005, 'stormfeather', 'Stormfeather', 18),
  (110003, 'lodizal', 'Lodizal', 18),
  (117000, 'kelorek_dar', 'Kelorek`Dar', 162),
  (120084, 'klandicar', 'Klandicar', 66),
  (120005, 'sontalak', 'Sontalak', 66),
  (123115, 'zlandicar', 'Zlandicar', 66),
  (119112, 'wuoshi', 'Wuoshi', 162),
  (128090, 'nanzata_warder', 'Nanzata the Warder', 162),
  (128091, 'ventani_warder', 'Ventani the Warder', 162),
  (128092, 'tukaarak_warder', 'Tukaarak the Warder', 162),
  (128093, 'hraashna_warder', 'Hraashna the Warder', 162),
  (128132, 'final_arbiter', 'The Final Arbiter', 162),
  (128125, 'progenitor', 'The Progenitor', 162),
  (124003, 'lord_vyemm', 'Lord Vyemm', 162),
  (124010, 'aaryonar', 'Aaryonar', 162),
  (124020, 'lendiniara_keeper', 'Lendiniara the Keeper', 162),
  (124002, 'dozekar_the_cursed', 'Dozekar the Cursed', 66),
  (124001, 'ikatiar_venom', 'Ikatiar the Venom', 162),
  (124008, 'lord_feshlak', 'Lord Feshlak', 162),
  (124011, 'dagarn_destroyer', 'Dagarn the Destroyer', 162),
  (124017, 'eashen_sky', 'Eashen of the Sky', 162),
  (124074, 'lord_kreizenn', 'Lord Kreizenn', 162),
  (124076, 'lady_nevederia', 'Lady Nevederia', 162),
  (124128, 'vulak_aerr', 'Vulak`Aerr', 162),
  (162065, 'emperor_ssraeshza', 'Emperor Ssraeshza', 162),
  (162076, 'high_priest_ssraeshza', 'High Priest of Ssraeshza', 66),
  (162030, 'arch_lich_rhagzadune', 'Arch Lich Rhag`Zadune', 66.05),
  (162039, 'vyzhDra_exiled', 'Vyzh`dra the Exiled', 66),
  (162042, 'vyzhDra_cursed', 'Vyzh`dra the Cursed', 66),
  (162190, 'xerkizh_creator', 'Xerkizh The Creator', 66.05),
  (162178, 'rhag_zhezum', 'Rhag`Zhezum', 66.05),
  (162192, 'rhag_mozdezh', 'Rhag`Mozdezh', 66.05),
  (162189, 'blood_ssraeshza', 'Blood of Ssraeshza', 18),
  (159000, 'lord_inquisitor_seru', 'Lord Inquisitor Seru', 162),
  (159035, 'praesertum_matpa', 'Praesertum Matpa', 18),
  (159052, 'praesertum_bikun', 'Praesertum Bikun', 18),
  (159054, 'praesertum_rhugol', 'Praesertum Rhugol', 18),
  (159055, 'praesertum_vantorus', 'Praesertum Vantorus', 18),
  (163156, 'grieg_veneficus', 'Grieg Veneficus', 66.05),
  (163273, 'servitor_luclin', 'Servitor of Luclin', 66.05),
  (163058, 'praetorian_myral', 'Praetorian Myral', 18),
  (160375, 'lcea_katta', 'Lcea Katta', 66.05),
  (164078, 'thought_horror_overfiend', 'Thought Horror Overfiend', 66.05),
  (164011, 'burrower_parasite', 'A Burrower Parasite', 66.05),
  (179001, 'insanity_crawler', 'The Insanity Crawler', 66.05),
  (179017, 'shei_vinitras', 'Shei Vinitras', 66),
  (179037, 'itraer_vius', 'The Itraer Vius', 66.05),
  (179178, 'va_dyn', 'The Va`Dyn', 66.05),
  (176000, 'netherbian_swarmlord', 'Netherbian Swarmlord', 66.05),
  (176002, 'rumblecrush', 'Rumblecrush', 66.05),
  (176017, 'doomshade', 'Doomshade', 66.05),
  (176089, 'zelnithak', 'Zelnithak', 66.05),
  (158436, 'aten_ha_ra', 'Aten Ha Ra', 162),
  (158437, 'kaas_thox_xi_aten_ha_ra_north', 'Kaas Thox Xi Aten Ha Ra (North)', 162),
  (158464, 'kaas_thox_xi_aten_ha_ra_south', 'Kaas Thox Xi Aten Ha Ra (South)', 162),
  (158440, 'va_xi_aten_ha_ra', 'Va Xi Aten Ha Ra', 162),
  (158439, 'thall_va_kelun', 'Thall Va Kelun', 162),
  (158441, 'diabo_xi_va_temariel', 'Diabo Xi Va Temariel', 162),
  (158442, 'thall_xundraux_diabo', 'Thall Xundraux Diabo', 162),
  (158443, 'diabo_xi_xin_thall', 'Diabo Xi Xin Thall', 162),
  (158444, 'kaas_thox_xi_ans_dyek', 'Kaas Thox Xi Ans Dyek', 162),
  (158081, 'va_dyn_khar', 'Va Dyn Khar', 162),
  (158446, 'diabo_xi_xin', 'Diabo Xi Xin', 162),
  (158445, 'diabo_xi_va', 'Diabo Xi Va', 162),
  (158465, 'thall_va_xakra_south', 'Thall Va Xakra (South)', 162),
  (158136, 'thall_va_xakra_north', 'Thall Va Xakra (North)', 162),
  (154017, 'an_escaped_burrower', 'An Escaped Burrower', 66),
  (154015, 'a_summoned_burrower', 'A Summoned Burrower', 66),
  (154016, 'a_restless_burrower', 'A Restless Burrower', 66),
  (162037, 'a_glyph_covered_serpent', 'a glyph covered serpent', 66)),
kill AS (
  SELECT e.id,
         b.boss_key, b.boss_name,
         COALESCE(e.ended_at, e.started_at + make_interval(secs => COALESCE(e.duration_sec, 0)))
           AS killed_at,
         (e.raid_night_id IS NOT NULL) AS in_raid_night,
         -- Sun/Wed/Thu 20:30–23:30 ET, matching utils/timezone.js isInRaidWindow.
         (    EXTRACT(dow  FROM (e.started_at AT TIME ZONE 'America/New_York')) IN (0, 3, 4)
          AND (EXTRACT(hour FROM (e.started_at AT TIME ZONE 'America/New_York')) * 60
             + EXTRACT(minute FROM (e.started_at AT TIME ZONE 'America/New_York'))) >= 1230
          AND (EXTRACT(hour FROM (e.started_at AT TIME ZONE 'America/New_York')) * 60
             + EXTRACT(minute FROM (e.started_at AT TIME ZONE 'America/New_York'))) <  1410
         ) AS in_raid_window,
         b.timer_hours
    FROM encounters e
    JOIN boss b ON b.npc_id = e.npc_id
   WHERE e.ended_at IS NOT NULL          -- confirmed kill only; a wipe locks nobody
),
-- Everyone the parses can PROVE was there. Four sources, because a damage list
-- alone misses the case that prompted this: Taeya is a cleric, so she has no
-- encounter_players row on the very kill she uploaded.
present AS (
  SELECT k.id, c.contributor_character AS nm FROM kill k
    JOIN contributions c ON c.encounter_id = k.id
  UNION
  SELECT k.id, p.character_name FROM kill k
    JOIN encounter_players p ON p.encounter_id = k.id
  UNION
  SELECT k.id, h->>'name' FROM kill k
    JOIN contributions c ON c.encounter_id = k.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.raw_parse->'healers', '[]'::jsonb)) h
  UNION
  SELECT k.id, d->>'name' FROM kill k
    JOIN contributions c ON c.encounter_id = k.id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.raw_parse->'defenders', '[]'::jsonb)) d
),
-- Same filter as utils/killLockouts.normalizeCharacterName: one capitalized
-- word, 3–15 letters. Drops pets ("Gyzak`s pet"), NPCs and parser placeholders.
named AS (
  SELECT id, upper(left(nm, 1)) || lower(substr(nm, 2)) AS character
    FROM present
   WHERE nm ~ '^[A-Za-z]{3,15}$'
     AND lower(nm) NOT IN ('you','unknown','pet','none','null','undefined',
                           'total','totals','raid','group','yourself')
),
-- One row per (character, boss): the most recent kill wins, because a lockout
-- cannot be held twice on one boss and the latest is the one still binding.
latest AS (
  SELECT DISTINCT ON (n.character, k.boss_key)
         n.character, k.boss_key, k.boss_name, k.id AS encounter_id,
         k.killed_at,
         -- timer_hours carries fractional hours for the Ssra respawns (66.05),
         -- and make_interval takes integers — split it rather than truncate.
         k.killed_at + make_interval(hours => k.timer_hours::int,
                                     mins  => ((k.timer_hours - floor(k.timer_hours)) * 60)::int)
           AS expires_at,
         CASE WHEN k.in_raid_night  THEN true
              WHEN k.in_raid_window THEN NULL       -- unknown, never an accusation
              ELSE false END AS ours
    FROM named n
    JOIN kill  k ON k.id = n.id
   ORDER BY n.character, k.boss_key, k.killed_at DESC
)
INSERT INTO character_lockouts
  (guild_id, character, boss_key, boss_name, expires_at, implied_kill_at,
   ours, observed_at, observed_by, source, encounter_id)
SELECT 'wolfpack', character, boss_key, boss_name, expires_at, killed_at,
       ours, now(), NULL, 'kill', encounter_id
  FROM latest
 WHERE expires_at > now()                -- an already-lifted lockout is noise
ON CONFLICT (guild_id, character, boss_key) DO UPDATE
  SET boss_name       = EXCLUDED.boss_name,
      expires_at      = EXCLUDED.expires_at,
      implied_kill_at = EXCLUDED.implied_kill_at,
      ours            = EXCLUDED.ours,
      observed_at     = EXCLUDED.observed_at,
      source          = EXCLUDED.source,
      encounter_id    = EXCLUDED.encounter_id
  -- Never downgrade a live /sll observation to a computed one.
  WHERE character_lockouts.source <> 'sll'
     OR character_lockouts.expires_at <= now();
