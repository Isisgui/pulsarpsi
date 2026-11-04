# Pulsar Psicologia

Site estático (HTML + CSS + JavaScript puro) que funciona como cartão de visita e portal de agendamento.
Pronto para o GitHub Pages — não tem etapa de build.

## Estrutura

```
index.html                  página única (hero, sobre, agenda, links)
css/style.css               estilos, animações e responsivo
js/config.js                ⚙️  configurações (URL da agenda, WhatsApp)
js/api.js                   comunicação com o Google Planilhas
js/booking.js               calendário, horários e modal de agendamento
js/starfield.js, js/main.js fundo animado e navegação
apps-script/Code.gs         "backend" que roda preso à planilha (Google Apps Script)
apps-script/appsscript.json permissões: só a própria planilha + enviar e-mail
scripts/                    ferramentas: servidor local e diagnóstico (npm run check)
tests/                      testes automáticos (backend, frontend e navegador)
```

O site em si não tem etapa de build: o GitHub Pages publica os arquivos como estão.
O `package.json` só existe para as ferramentas de desenvolvimento (testes, servidor local e
diagnóstico) — nada disso é necessário para publicar.

## Ligar ao Google Planilhas (passo a passo, só pelo navegador)

Não precisa instalar nada nem ativar APIs. Faça tudo **na conta Google dona da agenda**
(se o navegador tiver várias contas, confira o avatar no canto superior direito em cada passo).

### 1. Criar a planilha e o projeto de script

1. Crie uma planilha em <https://sheets.new> e dê um nome (ex.: `Agenda Pulsar`).
   **Não compartilhe** a planilha.
2. Na planilha: **Extensões → Apps Script**.
   > ⚠️ Tem que ser **por dentro da planilha**. Um projeto criado direto em
   > script.google.com não fica ligado a ela e não funciona.

### 2. Colar os dois arquivos

1. No editor, clique em ⚙️ **Configurações do projeto** (barra da esquerda) e marque
   **Mostrar arquivo de manifesto "appsscript.json" no editor**.
2. Volte em **< > Editor**. Na lista **Arquivos** devem existir só `Código.gs` e `appsscript.json`
   (se houver outro `.gs`, apague-o: ⋮ → Excluir).
3. Abra `appsscript.json` → **Ctrl+A** → cole todo o conteúdo de
   [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Abra `Código.gs` → **Ctrl+A** → cole todo o conteúdo de
   [`apps-script/Code.gs`](apps-script/Code.gs).
   (No GitHub, o botão **Copy raw file** copia o arquivo inteiro.)
5. **Ctrl+S** para salvar.

### 3. Criar as abas e autorizar

1. No topo do editor, no menu ao lado de **▷ Executar** / **Depurar**, escolha **`setup`**.
2. Clique em **▷ Executar** → **Revisar permissões** → escolha a conta dona.
3. "O Google não verificou este app" → **Avançado → Acessar Agenda Pulsar (não seguro)**.
   É normal: o "app" é o seu próprio script.
4. Confira que pede **somente**: *ver e gerenciar planilhas em que este app foi instalado*,
   *enviar e-mail como você* e *ver seu endereço de e-mail* → **Permitir**.
   (Se pedir "todas as planilhas" ou "Google Drive", o `appsscript.json` não foi colado direito.)
5. O registro mostra "Execução concluída" e a planilha ganha as abas
   `Horarios`, `Bloqueios` e `Agendamentos`.

Opcional: escolha **`teste`** e execute. Deve aparecer, em vermelho (de propósito),
`[resultado do teste] OK (versão …)`.

### 4. Publicar como App da Web

1. **Implantar → Nova implantação**.
2. Em "Selecionar tipo" (⚙️) escolha **App da Web**.
3. **Executar como: Eu (seu e-mail)** · **Quem pode acessar: Qualquer pessoa**.
4. **Implantar** e copie a **URL do app da Web** (termina em `/exec`).

### 5. Conferir no navegador

Abra numa aba anônima: `SUA_URL/exec?action=health`

Deve aparecer algo como:

```json
{"ok":true,"version":"2026-11-02.2","checks":{"spreadsheet":true,"tabs":true,"weeklySlots":26,"notifyEmail":true},"timezone":{"script":"America/Sao_Paulo","spreadsheet":"America/Sao_Paulo"},"freeDays":44}
```

Se aparecer outra coisa, veja [Quando algo não funciona](#quando-algo-não-funciona).

### 6. Ligar o site

1. Cole a URL em `apiUrl` no [`js/config.js`](js/config.js).
2. Rode o site local e faça um agendamento de teste:

   ```bash
   python3 -m http.server 8000      # ou: npm run dev
   ```

   Abra <http://localhost:8000>, marque um horário, confira a linha na aba `Agendamentos`
   e o e-mail recebido. Depois apague a linha.
3. Opcional (com Node.js): `npm run check` deve terminar com `✔ O site recebe os horários.`
4. Commit + push. O GitHub Pages publica sozinho.

### 7. Montar a agenda de verdade na planilha

- **`Horarios`**: um dia da semana por linha e os horários separados por vírgula
  (`Segunda` | `09:00, 10:00`). Vem com horários de exemplo — troque pelos reais.
- **`Bloqueios`**: data (e horário, opcional) para fechar um dia ou um horário pontual.
- **`Agendamentos`**: preenchida pelo site. Mude o **Status** para `cancelado` para liberar o horário.

Mais detalhes no [Guia de uso da planilha](#guia-de-uso-da-planilha).

### Alterou o `Code.gs`? Publique uma **nova versão** (mesma URL)

1. Aumente `VERSION` no topo do `Code.gs`.
2. Cole o arquivo inteiro no editor e salve.
3. **Implantar → Gerenciar implantações → ✏️ Editar → Versão: "Nova versão" → Implantar.**

> ⚠️ Só salvar **não** muda o que a URL serve. E **"Nova implantação"** cria **outra** URL —
> aí é preciso trocar o `apiUrl` também.

Se o novo código pedir permissões diferentes, rode `setup` de novo para autorizar.

### Quando algo não funciona

Com Node.js instalado, `npm run check` testa a URL do `js/config.js` e diz o que fazer
(`npm run check -- URL` testa outra URL). Sem Node, abra `URL?action=health` no navegador:

| O que aparece | Causa | Como resolver |
| --- | --- | --- |
| Erro de **CORS** no console do site, ou página **"Acesso negado"** / 403 | Script não autorizado pela conta dona, ou acesso não está "Qualquer pessoa" | Passo 3 (rodar `setup` e permitir) com a conta dona; depois confira o passo 4.3 em **Gerenciar implantações → ✏️** |
| Página pedindo **login** do Google | "Quem pode acessar" não está em **Qualquer pessoa** | **Gerenciar implantações → ✏️ → Qualquer pessoa → Implantar** |
| `{"ok":false,"error":"Ação desconhecida."}` sem `version` | A URL serve um código antigo | Cole o `Code.gs` atual e publique **nova versão** |
| `"version"` diferente do `VERSION` do `Code.gs` | Idem | Idem |
| `"code":"NO_SPREADSHEET"` | Projeto criado fora da planilha | Refaça o passo 1.2 pela planilha |
| `"code":"NO_HOURS"` | Aba `Horarios` sem horários válidos | Preencha: `Segunda` \| `09:00, 10:00` |
| Página "Não foi possível abrir o arquivo" / 404 | URL copiada errada ou implantação arquivada | Copie de novo em **Gerenciar implantações** |
| Rodou uma função e "não aparece nada" | A função escolhida no menu não era a que você queria | Confira o nome ao lado de **▷ Executar** |

No editor, **Execuções** (ícone ☰ na barra da esquerda) mostra os erros de cada visita ao site.
No navegador, o console do site mostra `[Pulsar] agenda: CÓDIGO — detalhe`.

## Desenvolvimento

```bash
npm test             # 71 testes: regras da agenda, segurança, js/api.js e o site no Chrome
npm run dev:mock     # site local com uma planilha simulada na memória (não usa o Google)
```

Os testes rodam o `Code.gs` de verdade sobre uma simulação do Google
(`scripts/lib/gas-mock.mjs`) que imita as conversões automáticas de data/hora da
planilha, fusos horários diferentes, trava ocupada e falha de e-mail. O teste de
navegador usa o Chrome instalado (é pulado se não houver).

## Publicar no GitHub Pages

Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.

## Guia de uso da planilha

Tudo é feito na planilha e vale na hora: o site lê a planilha a cada visita.

### `Horarios`: a semana padrão

Coloque um dia da semana por linha e os horários de início das sessões separados por vírgula.

| Dia da semana | Horários |
| --- | --- |
| `Segunda` | `09:00, 10:00, 14:00` |
| `Quarta` | `13:00, 14:00` |

- Dia sem linha não tem atendimento.
- Aceita `Segunda`/`seg` e `9`, `9h`, `09:00`.

### `Bloqueios`: folgas, feriados e imprevistos

| Data | Horário | Motivo |
| --- | --- | --- |
| `25/12/2026` | *(vazio)* | Natal: fecha **o dia todo** |
| `10/11/2026` | `14:00` | Fecha **só esse horário** |

- Para fechar um período (ex.: férias), use uma linha por dia.
- Para reabrir, apague a linha.
- O motivo é só para você: o site não lê essa coluna.

### `Agendamentos`: as reservas

O site preenche esta aba sozinho, e cada reserva também chega por e-mail.
No dia a dia, você só mexe na coluna **Status**:

| Status | Significado | O que fazer |
| --- | --- | --- |
| `pendente` | Reserva nova | Confirme com a pessoa e mude para `confirmado` |
| `revisar` | Esse WhatsApp/e-mail já tinha 2+ horários futuros. O e-mail chega com `[REVISAR]` | Verifique e mude para `confirmado` ou `cancelado` |
| `confirmado` | Sessão combinada | — |
| `cancelado` | Sessão desmarcada | **O horário volta a aparecer no site** |

Todo status diferente de `cancelado` mantém o horário ocupado.
Para reservar um horário manualmente (ex.: paciente que marcou pelo WhatsApp), adicione uma linha com data e horário.

### Regras automáticas

O site mostra os próximos 60 dias e não aceita reservas com menos de 12 horas de antecedência.
Também não permite duas reservas no mesmo horário.
Esses valores ficam no topo do `Code.gs`.

> Não renomeie as abas nem a linha de cabeçalho, e não apague colunas.

## Segurança (repositório público)

- **Não há segredo no repositório.** A URL `/exec` é pública por natureza (aparece no
  navegador de qualquer visitante); publicá-la no GitHub não abre nada além do que o site já abre.
- **O script só enxerga esta planilha** (`@OnlyCurrentDoc` + escopo `spreadsheets.currentonly`).
  Mesmo que alguém altere o código no GitHub, isso não muda o script que está na conta Google —
  só quem é editor da planilha pode mudá-lo.
- **A API nunca devolve dados de pacientes**: só a lista de horários livres e um
  diagnóstico (`?action=health`) com versão, fusos e contagens — sem nomes, e-mails ou telefones.
- **O site só envia dados para `script.google.com`** (`js/api.js` recusa qualquer outro endereço;
  servidor local só é aceito quando o próprio site está rodando local).
- **Contra abuso**: campo-armadilha para robôs, no máximo 15 agendamentos por hora e, a partir do
  3º horário futuro do mesmo WhatsApp/e-mail, status `revisar` (ajuste no topo do `Code.gs`).
- **O site nunca revela se alguém já é paciente**: a resposta é sempre a mesma.
- Os dados de pacientes ficam só na planilha e no e-mail da conta dona dela. Mantenha a planilha
  sem compartilhamento e a conta Google com verificação em duas etapas.
- Para cortar o acesso a qualquer momento: **Implantar → Gerenciar implantações → Arquivar**.

## Personalizar

- Textos, CRP e links: `index.html` (procure por `TODO`).
- Foto: substitua `assets/foto-isis.jpg` (proporção ~3:4).
- Cores: variáveis no topo de `css/style.css`.
