export function localhostOnly(req, res, next) {
  const remoteIp = req.ip || req.connection?.remoteAddress;
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteIp);
  if (!isLocal) {
    return res.status(403).json({ error: 'Can only be triggered from localhost' });
  }
  next();
}
