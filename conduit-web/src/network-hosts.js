/*
 * The addresses Conduit treats as not crossing the internet: this machine, or
 * the network it is sitting on. Shared by the client (which origins may be
 * plain HTTP), the preferences store (which ones it will keep for every
 * client) and the auth middleware (which peers may be handed a token without
 * TLS) -- the three have to draw the same line, so there is one copy of it.
 */
export const LOOPBACK_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/;
// 10/8, 172.16/12, 192.168/16 and the 169.254/16 a machine gives itself when
// nothing handed it an address.
export const PRIVATE_HOST = /^(10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2})$/;
