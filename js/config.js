/**
 * Configuração do site.
 *
 * `apiUrl` é a URL do App da Web do Google Apps Script ligado à planilha
 * (termina em `/exec`). Veja o passo a passo no README.
 *
 * Essa URL é pública por natureza (qualquer visitante a vê no navegador),
 * então pode ficar no repositório. Ela só dá acesso ao que o script expõe:
 * consultar horários livres e criar um agendamento — nunca ler a planilha.
 */
window.PULSAR_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxzC6KR0J4x-uD5nlcaqP7m43M9LnX2LDqqZUxkINldxQGeAp_IKuF_CfUzV3rZtyjd/exec",

  // Quantos dias à frente o calendário mostra. Mantenha igual a DAYS_AHEAD do Code.gs.
  daysAhead: 60,

  // Duração da sessão, só para exibição.
  sessionMinutes: 50,

  // Número com DDI + DDD, só dígitos. Usado no botão "Avisar no WhatsApp".
  whatsapp: "5522992332096",
};
