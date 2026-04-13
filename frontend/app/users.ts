export interface FakeUser {
  id: string;
  name: string;
  lat: number;
  lng: number;
  emoji: string;
}

const EMOJIS = ['🧑', '👩', '👨', '🧔', '👱', '🧕', '👮', '🚴', '🏃', '🚶', '🧍', '👷', '🧑‍💻', '🧑‍🎤', '🧑‍🍳', '🧑‍🎨', '🧑‍🚒', '🧑‍✈️', '🧑‍🏫'];

const FAKE_USERS: FakeUser[] = [
  { id: 'u01', name: 'Alex',     lat: 41.8827, lng: -87.6233, emoji: EMOJIS[0]  },  // The Loop
  { id: 'u02', name: 'Jordan',   lat: 41.8956, lng: -87.6261, emoji: EMOJIS[1]  },  // River North
  { id: 'u03', name: 'Taylor',   lat: 41.9088, lng: -87.6339, emoji: EMOJIS[2]  },  // Lincoln Park
  { id: 'u04', name: 'Morgan',   lat: 41.9250, lng: -87.6511, emoji: EMOJIS[3]  },  // Lakeview
  { id: 'u05', name: 'Casey',    lat: 41.9483, lng: -87.6556, emoji: EMOJIS[4]  },  // Wrigleyville
  { id: 'u06', name: 'Riley',    lat: 41.9742, lng: -87.6690, emoji: EMOJIS[5]  },  // Andersonville
  { id: 'u07', name: 'Drew',     lat: 41.9900, lng: -87.6883, emoji: EMOJIS[6]  },  // Rogers Park
  { id: 'u08', name: 'Avery',    lat: 41.8664, lng: -87.6167, emoji: EMOJIS[7]  },  // South Loop
  { id: 'u09', name: 'Quinn',    lat: 41.8476, lng: -87.6284, emoji: EMOJIS[8]  },  // Bridgeport
  { id: 'u10', name: 'Skyler',   lat: 41.8302, lng: -87.6315, emoji: EMOJIS[9]  },  // Armour Square
  { id: 'u11', name: 'Peyton',   lat: 41.8131, lng: -87.6453, emoji: EMOJIS[10] },  // Englewood
  { id: 'u12', name: 'Reese',    lat: 41.7998, lng: -87.6588, emoji: EMOJIS[11] },  // Auburn Gresham
  { id: 'u13', name: 'Finley',   lat: 41.7812, lng: -87.6720, emoji: EMOJIS[12] },  // Roseland
  { id: 'u14', name: 'Parker',   lat: 41.9022, lng: -87.6767, emoji: EMOJIS[13] },  // Bucktown
  { id: 'u15', name: 'Harlow',   lat: 41.9177, lng: -87.6882, emoji: EMOJIS[14] },  // Wicker Park
  { id: 'u16', name: 'Emery',    lat: 41.8989, lng: -87.7033, emoji: EMOJIS[15] },  // Humboldt Park
  { id: 'u17', name: 'Rowan',    lat: 41.8790, lng: -87.7154, emoji: EMOJIS[16] },  // Austin
  { id: 'u18', name: 'Blake',    lat: 41.8601, lng: -87.7244, emoji: EMOJIS[17] },  // Cicero border
  { id: 'u19', name: 'Sage',     lat: 41.8423, lng: -87.7088, emoji: EMOJIS[18] },  // Little Village
  { id: 'u20', name: 'River',    lat: 41.8267, lng: -87.6934, emoji: EMOJIS[19] },  // Pilsen
  { id: 'u21', name: 'Hollis',   lat: 41.8101, lng: -87.6812, emoji: EMOJIS[0]  },  // Back of the Yards
  { id: 'u22', name: 'Lennon',   lat: 41.9344, lng: -87.7214, emoji: EMOJIS[1]  },  // Logan Square
  { id: 'u23', name: 'Phoenix',  lat: 41.9512, lng: -87.7355, emoji: EMOJIS[2]  },  // Albany Park
  { id: 'u24', name: 'Storm',    lat: 41.9688, lng: -87.7500, emoji: EMOJIS[3]  },  // Jefferson Park
  { id: 'u25', name: 'Ember',    lat: 41.9833, lng: -87.7655, emoji: EMOJIS[4]  },  // Norwood Park
  { id: 'u26', name: 'Arden',    lat: 41.8745, lng: -87.6400, emoji: EMOJIS[5]  },  // Near West Side
  { id: 'u27', name: 'Shiloh',   lat: 41.8612, lng: -87.6534, emoji: EMOJIS[6]  },  // Pilsen edge
  { id: 'u28', name: 'Cove',     lat: 41.8900, lng: -87.6100, emoji: EMOJIS[7]  },  // Streeterville
  { id: 'u29', name: 'Atlas',    lat: 41.8750, lng: -87.5950, emoji: EMOJIS[8]  },  // Museum Campus
  { id: 'u30', name: 'Zephyr',   lat: 41.8545, lng: -87.6050, emoji: EMOJIS[9]  },  // Bronzeville
  { id: 'u31', name: 'Vale',     lat: 41.8355, lng: -87.6122, emoji: EMOJIS[10] },  // Douglas
  { id: 'u32', name: 'Onyx',     lat: 41.7950, lng: -87.5980, emoji: EMOJIS[11] },  // South Shore
  { id: 'u33', name: 'Lark',     lat: 41.7700, lng: -87.5890, emoji: EMOJIS[12] },  // South Chicago
  { id: 'u34', name: 'Wren',     lat: 41.7501, lng: -87.5760, emoji: EMOJIS[13] },  // East Side
  { id: 'u35', name: 'Cleo',     lat: 41.9133, lng: -87.6500, emoji: EMOJIS[14] },  // Old Town
  { id: 'u36', name: 'Dune',     lat: 41.9377, lng: -87.6400, emoji: EMOJIS[15] },  // Uptown
  { id: 'u37', name: 'Fox',      lat: 41.9600, lng: -87.6622, emoji: EMOJIS[16] },  // Edgewater
  { id: 'u38', name: 'Gale',     lat: 41.8822, lng: -87.7400, emoji: EMOJIS[17] },  // Garfield Park
  { id: 'u39', name: 'Haven',    lat: 41.8688, lng: -87.7566, emoji: EMOJIS[18] },  // West Garfield Park
  { id: 'u40', name: 'Indigo',   lat: 41.9055, lng: -87.7266, emoji: EMOJIS[19] },  // Hermosa
  { id: 'u41', name: 'Juno',     lat: 41.9233, lng: -87.7488, emoji: EMOJIS[0]  },  // Belmont Cragin
  { id: 'u42', name: 'Knox',     lat: 41.9411, lng: -87.7633, emoji: EMOJIS[1]  },  // Portage Park
  { id: 'u43', name: 'Luna',     lat: 41.8155, lng: -87.6622, emoji: EMOJIS[2]  },  // Gage Park
  { id: 'u44', name: 'Mars',     lat: 41.7822, lng: -87.6400, emoji: EMOJIS[3]  },  // West Pullman
  { id: 'u45', name: 'Nova',     lat: 41.7611, lng: -87.6244, emoji: EMOJIS[4]  },  // Riverdale
  { id: 'u46', name: 'Orbit',    lat: 41.8478, lng: -87.7377, emoji: EMOJIS[5]  },  // West Lawn
  { id: 'u47', name: 'Pixel',    lat: 41.8333, lng: -87.7511, emoji: EMOJIS[6]  },  // Ashburn
  { id: 'u48', name: 'Quest',    lat: 41.8600, lng: -87.6766, emoji: EMOJIS[7]  },  // North Lawndale
  { id: 'u49', name: 'Rain',     lat: 41.9700, lng: -87.7122, emoji: EMOJIS[8]  },  // Forest Glen
  { id: 'u50', name: 'Sol',      lat: 41.8066, lng: -87.7144, emoji: EMOJIS[9]  },  // Chicago Lawn
];

export default FAKE_USERS;