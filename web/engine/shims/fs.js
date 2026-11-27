const no = () => { throw new Error('fs is not available in the browser engine'); };
const fs = { existsSync: () => false, readdirSync: () => [], mkdirSync: no, writeFileSync: no, readFileSync: no, rmSync: no, copyFileSync: no };
export default fs; export const { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } = fs;
