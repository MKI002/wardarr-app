// Titles shown in the demo.
//
// FILMS are real films in the public domain in the United States and in the
// European Union (see docs/demo.md). Their overviews are written for this
// project and their posters are drawn for it (apps/web/src/demo/posters).
// SERIES are invented. Ratings and TMDB-style ids are invented as well.
//
// `seerr` holds the Seerr media status for HD and 4K:
// 1 unknown, 2 requested, 3 processing, 4 partial, 5 available.

/** An invented API key that the demo mocks accept. */
export const DEMO_KEY = '0000000000000000000000000000d3m0';

export const FILMS = [
  {
    key: 'nosferatu',
    tmdbId: 91922,
    title: 'Nosferatu',
    year: 1922,
    rating: 7.8,
    poster: 'demo-nosferatu',
    seerr: [5, 5],
    inLibrary: true,
    overview:
      'An estate agent travels to the Carpathians to sell a house to the reclusive Count Orlok, who follows him home and brings a plague with him. F. W. Murnau’s silent classic of German Expressionism.',
  },
  {
    key: 'moon',
    tmdbId: 91902,
    title: 'A Trip to the Moon',
    year: 1902,
    rating: 8.0,
    poster: 'demo-trip-to-the-moon',
    seerr: [5, 3],
    inLibrary: true,
    overview:
      'A congress of astronomers fires itself to the Moon in a giant shell, meets its inhabitants and escapes back to Earth. Georges Méliès’ fourteen-minute fantasy, full of stage tricks.',
  },
  {
    key: 'train',
    tmdbId: 91903,
    title: 'The Great Train Robbery',
    year: 1903,
    rating: 6.9,
    poster: 'demo-great-train-robbery',
    seerr: [3, 1],
    inLibrary: false,
    overview:
      'Bandits hold up a steam train, rob its passengers and flee on horseback, with a posse close behind. Edwin S. Porter’s twelve-minute western, an early landmark of film editing.',
  },
  {
    key: 'intolerance',
    tmdbId: 91916,
    title: 'Intolerance',
    year: 1916,
    rating: 7.6,
    poster: 'demo-intolerance',
    seerr: [5, 3],
    inLibrary: true,
    overview:
      'Four stories from four eras, from the fall of Babylon to a modern city, are cut together to show how intolerance repeats through history. D. W. Griffith’s monumental silent epic.',
  },
  {
    key: 'nanook',
    tmdbId: 91921,
    title: 'Nanook of the North',
    year: 1922,
    rating: 7.4,
    poster: 'demo-nanook',
    seerr: [2, 1],
    inLibrary: false,
    overview:
      'A year with an Inuk hunter and his family on the coast of Hudson Bay: building an igloo, fishing through the ice, trading at the post. Robert J. Flaherty’s early feature-length documentary.',
  },
];

export const SERIES = [
  {
    key: 'lanternfall',
    tmdbId: 92001,
    title: 'Lanternfall',
    year: 2024,
    rating: 8.2,
    poster: 'demo-lanternfall',
    seerr: [4, 1],
    seasons: [
      { n: 1, episodes: 8, status: 5 },
      { n: 2, episodes: 8, status: 3 },
    ],
    overview:
      'When every lighthouse on a stormy coast goes dark on the same night, a young keeper sets out to learn who is switching them off.',
  },
  {
    key: 'salt',
    tmdbId: 92002,
    title: 'The Salt Archive',
    year: 2023,
    rating: 7.7,
    poster: 'demo-salt-archive',
    seerr: [5, 1],
    seasons: [
      { n: 1, episodes: 6, status: 5 },
      { n: 2, episodes: 6, status: 5 },
    ],
    overview:
      'Two archivists catalogue the records of a drowned town and find that some of the letters are dated next week.',
  },
  {
    key: 'kestrel',
    tmdbId: 92003,
    title: 'Kestrel Station',
    year: 2025,
    rating: 7.1,
    poster: 'demo-kestrel-station',
    seerr: [3, 1],
    seasons: [{ n: 1, episodes: 10, status: 3 }],
    overview:
      'The crew of a remote weather station keeps the forecasts coming while the storm outside starts answering back.',
  },
];
