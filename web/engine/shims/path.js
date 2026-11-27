const join = (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/');
const dirname = (p) => p.replace(/\/[^/]*$/, '') || '/';
export default { join, dirname, resolve: join }; export { join, dirname }; export const resolve = join;
