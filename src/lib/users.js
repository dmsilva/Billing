// Regras partilhadas entre o formulário e a função do Netlify que cria contas.
export const NEW_USER_ROLES = ['rececao', 'admin']
export const MIN_PASSWORD = 8

export function validateNewUser({ email, nome, role, password, modo }) {
  const clean = {
    email: String(email || '').trim().toLowerCase(),
    nome: String(nome || '').trim(),
    role,
    modo: modo === 'password' ? 'password' : 'convite',
    password: password || '',
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return { error: 'Email inválido.' }
  if (!NEW_USER_ROLES.includes(role)) return { error: 'Escolhe o papel: Receção ou Administradora.' }
  if (clean.modo === 'password' && clean.password.length < MIN_PASSWORD) return { error: `A palavra-passe tem de ter pelo menos ${MIN_PASSWORD} caracteres.` }
  if (!clean.nome) clean.nome = clean.email.split('@')[0]
  return { value: clean }
}

export function friendlyCreateError(message = '') {
  if (/already (been )?registered|already exists|duplicate/i.test(message)) return 'Já existe uma conta com este email.'
  return message
}
