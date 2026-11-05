// Faturas que chegam por email: o programa do Gmail (Apps Script) e a passagem da fila para o ecrã de revisão.

export const EMAIL_SELECT = 'id, mensagem_id, nome_ficheiro, mime, tamanho, conta, remetente, assunto, recebido_em, estado, invoice_id, tratado_em, created_at'

// "CUR Gás Natural <no-reply@fe.curgasnatural.pt>" → "CUR Gás Natural"
export function senderName(from) {
  const s = String(from || '').trim()
  const m = s.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)
  if (m) return m[1].trim() || m[2]
  return s
}

export function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Ficheiro pronto para o ecrã de revisão, com a ligação à linha da fila (para a marcar como gravada).
export function rowToFile(row) {
  const file = new File([base64ToBytes(row.conteudo_b64)], row.nome_ficheiro || 'fatura.pdf', { type: row.mime || 'application/pdf' })
  file.emailFatura = { id: row.id, remetente: senderName(row.remetente), assunto: row.assunto || '' }
  return file
}

// Pesquisa no Gmail: emails com anexo que falam de fatura/recibo e ainda não foram enviados para a app.
export function gmailQuery(dias = 30) {
  return `has:attachment -from:me -label:"${LABEL}" newer_than:${Math.max(1, Math.round(dias))}d {fatura faturas factura facturas fatura-recibo invoice recibo}`
}
export const LABEL = 'Fatura Chalet'

// Programa para colar em script.google.com na conta Google que recebe as faturas.
export function buildAppsScript({ supabaseUrl, anonKey, chave, dias = 30 }) {
  return `// Fatura Chalet: envia para a app os PDFs/fotos de faturas que chegam a este Gmail.
// Corre sozinho a cada 15 minutos depois de executares a função "instalar" uma vez.
// Nada é gravado como fatura sem confirmares na app (página "Faturas do email").

const APP_URL = ${JSON.stringify(String(supabaseUrl || '').replace(/\/+$/, ''))};
const CHAVE_PUBLICA = ${JSON.stringify(anonKey || '')};
const CHAVE_SECRETA = ${JSON.stringify(chave || '')}; // não partilhes este código com ninguém
const PESQUISA = ${JSON.stringify(gmailQuery(dias))};
const ETIQUETA = ${JSON.stringify(LABEL)};
const MAX_BYTES = 5 * 1024 * 1024;   // a leitura automática aceita até ~5 MB
const MIN_IMAGEM = 40 * 1024;        // ignora logótipos e assinaturas pequenas

function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarFaturas').timeBased().everyMinutes(15).create();
  enviarFaturas();
}

function enviarFaturas() {
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  const conta = Session.getEffectiveUser().getEmail();
  const conversas = GmailApp.search(PESQUISA, 0, 30);
  let enviadas = 0;
  for (const conversa of conversas) {
    let tudoBem = true;
    for (const msg of conversa.getMessages()) {
      for (const anexo of msg.getAttachments({ includeInlineImages: false })) {
        const nome = anexo.getName() || 'fatura';
        let tipo = String(anexo.getContentType() || '').toLowerCase();
        if (/\\.pdf$/i.test(nome)) tipo = 'application/pdf';
        const imagem = /^image\\/(jpeg|png|webp)$/.test(tipo);
        if (tipo !== 'application/pdf' && !imagem) continue;
        const tamanho = anexo.getSize();
        if (tamanho > MAX_BYTES || (imagem && tamanho < MIN_IMAGEM)) continue;
        const resposta = UrlFetchApp.fetch(APP_URL + '/rest/v1/rpc/receber_fatura_email', {
          method: 'post',
          contentType: 'application/json',
          headers: { apikey: CHAVE_PUBLICA },
          payload: JSON.stringify({
            p_chave: CHAVE_SECRETA,
            p_mensagem_id: msg.getId(),
            p_nome_ficheiro: nome,
            p_mime: tipo,
            p_conteudo_b64: Utilities.base64Encode(anexo.getBytes()),
            p_conta: conta,
            p_remetente: msg.getFrom(),
            p_assunto: msg.getSubject(),
            p_recebido_em: msg.getDate().toISOString(),
          }),
          muteHttpExceptions: true,
        });
        if (resposta.getResponseCode() >= 300) {
          tudoBem = false;
          console.log('Falhou ' + nome + ': ' + resposta.getContentText());
        } else enviadas++;
      }
    }
    // Só marca a conversa quando tudo correu bem; senão tenta outra vez daqui a 15 minutos.
    if (tudoBem) conversa.addLabel(etiqueta);
  }
  console.log('Ficheiros enviados para a app: ' + enviadas);
}
`
}
