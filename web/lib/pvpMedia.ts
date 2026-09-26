// Fight film for /pvp: videos, clips and screenshots of a PvP night, hung on the biggest fight in
// its zone and time window (the guild lead, 2026-09-26: "Embed this video onto the PVP page along
// with these screenshots"). Add a night by adding an entry; the page finds its fight itself.
//
// Captions are OURS, not the uploader's: a clip's own title is whatever its maker typed.

export type PvpMediaItem =
  | { kind: 'youtube'; id: string; caption: string; credit: string }
  | { kind: 'medal'; id: string; caption: string; credit: string }
  | { kind: 'image'; src: string; width: number; height: number; caption: string; credit: string };

export type PvpNight = {
  key: string;
  title: string;
  zone: string;       // pvp_deaths.zone
  from: string;       // the night's window (ISO); the biggest fight in the zone inside it gets the film
  to: string;
  blurb: string;
  media: PvpMediaItem[];
};

export const PVP_NIGHTS: PvpNight[] = [
  {
    key: 'vex-thal-2026-09-25',
    title: 'Vex Thal: the alliance wipes the Zek train',
    zone: 'Vex Thal',
    from: '2026-09-26T03:00:00Z',
    to: '2026-09-26T09:00:00Z',
    blurb: 'Dungeons and Dragons, Wolf Pack, Freedom and one Squirrels of War against the Zeks at Aten Ha Ra. The Zeks trained in and were wiped at the zone in.',
    media: [
      { kind: 'youtube', id: '2z9vmYn0YwE', caption: 'Zek vs D&D and Wolf Pack: the train and the wipe', credit: 'Video from another player’s channel' },
      { kind: 'youtube', id: 'tqiBUsbQQlA', caption: 'Choppers dogpile', credit: 'Video by a Wolf Pack member' },
      { kind: 'medal', id: 'nBoGJ21saIFqt1hEC', caption: 'The train, then the wipe at the zone in', credit: 'Clip from a Dungeons and Dragons member' },
      { kind: 'medal', id: 'nBqeveqD3HneEirX9', caption: 'Clip 2', credit: 'Clip from a Dungeons and Dragons member' },
      { kind: 'medal', id: 'nBq6QD6ZzDDswExI6', caption: 'Clip 3', credit: 'Clip from a Dungeons and Dragons member' },
      { kind: 'medal', id: 'nBpoq7ELLTLFYgWPk', caption: 'Clip 4', credit: 'Clip from a Dungeons and Dragons member' },
    ],
  },
];

// More kills on a Wolf Pack member's channel.
export const PVP_CHANNEL = { url: 'https://www.youtube.com/@SirMalthur', label: 'Malthur’s YouTube channel' };

export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}`;
export const youtubeWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const medalEmbed = (id: string) => `https://medal.tv/games/screen-capture/clip/${id}`;
export const medalPage = (id: string) => `https://medal.tv/games/screen-capture/clips/${id}`;

export type PvpFightRow = {
  zone: string;
  started_at: string;
  ended_at: string;
  waves: number;
  deaths: number;
  player_kills: number;
  zek_deaths: number;
  rest_deaths: number;
  deaths_by_guild: Record<string, number> | null;
  top_killers: { killer: string; guild: string | null; kills: number }[] | null;
};

// The fight each night's film belongs to: the biggest fight in its zone inside its window.
export function nightForFight(fight: PvpFightRow, fights: PvpFightRow[], nights = PVP_NIGHTS): PvpNight | null {
  for (const n of nights) {
    const inside = (f: PvpFightRow) => f.zone === n.zone
      && Date.parse(f.started_at) < Date.parse(n.to) && Date.parse(f.ended_at) >= Date.parse(n.from);
    const best = fights.filter(inside).sort((a, b) => b.deaths - a.deaths)[0];
    if (best && best === fight) return n;
  }
  return null;
}
