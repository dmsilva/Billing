# Gera extratos sintéticos parecidos com os da CGD para os testes.
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
rows = [
  ("01-10-2026","01-10-2026","TRAVELSCAPE LLC 4471","","1.830,55","11.830,55"),
  ("03-10-2026","03-10-2026","TRF CRED SEPA+ 0001234","","120,00","11.950,55"),
  ("","","DE JOHN SMITH","","",""),
  ("05-10-2026","05-10-2026","ENDESA ENERGIA","45,02","","11.905,53"),
  ("06-10-2026","06-10-2026","TRF MB WAY P/ ANA COSTA","","250,00","12.155,53"),
  ("07-10-2026","07-10-2026","PAGAMENTO SERVICOS 1234","1 200,00","","10.955,53"),
]
def page_header(c, y):
  c.setFont("Helvetica-Bold", 8)
  for x, t in [(40,"Data mov."),(95,"Data valor"),(150,"Descrição")]: c.drawString(x, y, t)
  for r, t in [(420,"Débito"),(490,"Crédito"),(560,"Saldo")]: c.drawRightString(r, y, t)
c = canvas.Canvas(sys.argv[1], pagesize=A4)
c.setFont("Helvetica", 9)
c.drawString(40, 800, "Caixa Geral de Depósitos - Extrato Integrado")
c.drawString(40, 785, "Período: 01-10-2026 a 31-10-2026   Conta 0123 456789 001")
c.drawString(40, 770, "SALDO INICIAL"); c.drawRightString(560, 770, "10.000,00")
y = 740
page_header(c, y); y -= 16
c.setFont("Helvetica", 8)
for i, r in enumerate(rows):
  if i == 4:
    c.drawString(40, 40, "Página 1 de 2"); c.showPage(); y = 780; page_header(c, y); y -= 16; c.setFont("Helvetica", 8)
  for x, t in [(40,r[0]),(95,r[1]),(150,r[2])]: c.drawString(x, y, t)
  for rr, t in [(420,r[3]),(490,r[4]),(560,r[5])]:
    if t: c.drawRightString(rr, y, t)
  y -= 11
c.drawString(40, 40, "Página 2 de 2")
c.save()
