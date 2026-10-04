/** Shared HTML shell for transactional email. Inline styles: most clients ignore <style>. */

export function emailLayout(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;font-size:14px;line-height:1.55">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
  <p style="font-weight:600;margin-top:0">TaskNest</p>${body}</div></body></html>`;
}

export function emailButton(href: string, label: string): string {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#1467fb;color:#fff;text-decoration:none;font-weight:500">${escapeHtml(label)}</a></p>
  <p style="color:#64748b;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`;
}

export function emailMuted(text: string): string {
  return `<p style="color:#64748b;font-size:13px">${text}</p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}
