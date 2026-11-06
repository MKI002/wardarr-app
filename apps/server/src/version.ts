// Version of this Wardarr build, from the server package.
import pkg from '../package.json' with { type: 'json' };

export const APP_VERSION: string = pkg.version;
