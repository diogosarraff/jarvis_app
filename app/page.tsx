"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"
import {
  Game,
  OddsInput,
  RankingItem,
  ResultadoJogo,
  ResultadoJogador,
  calcularEvLocal,
  calcularScoreJarvis,
  calcularEvOver,
  calcularEvUnder,
  getLineBetRankingItem,
  getMinutesAverage,
  getModelConfidence,
  getPlayerOpponent,
  getPlayerTeam,
  getProbOver,
  getProbUnder,
  getProjectionFromGameHandicap,
  getProjectionFromGameTotal,
  getProjectionFromGameWinner,
  getProjectionFromPlayer,
  getWinnerBetRankingItem,
} from "../lib/jarvis-ui"

type MarketKey = "winner" | "total" | "handicap" | "pts" | "ast" | "reb" | "fg3m"

const PLAYER_LABELS: Record<Exclude<MarketKey, "winner" | "total" | "handicap">, string> = {
  pts: "Pontos",
  ast: "Assists",
  reb: "Rebotes",
  fg3m: "3 Pontos",
}

const MARKET_LABELS: Record<"winner" | "total" | "handicap", string> = {
  winner: "Vencedor",
  total: "Total",
  handicap: "Handicap",
}

export default function Home() {
  const [games, setGames] = useState<Game[]>([])
  const [winnerRows, setWinnerRows] = useState<ResultadoJogo[]>([])
  const [totalRows, setTotalRows] = useState<ResultadoJogo[]>([])
  const [handicapRows, setHandicapRows] = useState<ResultadoJogo[]>([])
  const [playerPointsRows, setPlayerPointsRows] = useState<ResultadoJogador[]>([])
  const [playerAssistsRows, setPlayerAssistsRows] = useState<ResultadoJogador[]>([])
  const [playerReboundsRows, setPlayerReboundsRows] = useState<ResultadoJogador[]>([])
  const [playerThreesRows, setPlayerThreesRows] = useState<ResultadoJogador[]>([])

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [activeGameMarket, setActiveGameMarket] = useState<"winner" | "total" | "handicap">("winner")
  const [activePlayerMarket, setActivePlayerMarket] = useState<"pts" | "ast" | "reb" | "fg3m">("pts")
  const [activeSection, setActiveSection] = useState<"jogos" | "jogadores" | "ranking">("jogos")
  const [loading, setLoading] = useState(true)
  const [oddsMap, setOddsMap] = useState<Record<string, OddsInput>>({})

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const [
        { data: gamesRes },
        { data: winnerRes },
        { data: totalRes },
        { data: handicapRes },
        { data: pointsRes },
        { data: assistsRes },
        { data: reboundsRes },
        { data: threesRes },
      ] = await Promise.all([
        supabase.from("agenda_hoje").select("*").order("data", { ascending: true }),
        supabase.from("resultado_vencedor").select("*"),
        supabase.from("resultado_total_pontos").select("*"),
        supabase.from("resultado_handicap").select("*"),
        supabase.from("resultado_player_points").select("*"),
        supabase.from("resultado_player_assists").select("*"),
        supabase.from("resultado_player_rebounds").select("*"),
        supabase.from("resultado_player_threes").select("*"),
      ])
      const gamesData = (gamesRes || []) as Game[]
      setGames(gamesData)
      setWinnerRows((winnerRes || []) as ResultadoJogo[])
      setTotalRows((totalRes || []) as ResultadoJogo[])
      setHandicapRows((handicapRes || []) as ResultadoJogo[])
      setPlayerPointsRows((pointsRes || []) as ResultadoJogador[])
      setPlayerAssistsRows((assistsRes || []) as ResultadoJogador[])
      setPlayerReboundsRows((reboundsRes || []) as ResultadoJogador[])
      setPlayerThreesRows((threesRes || []) as ResultadoJogador[])
      if (gamesData.length > 0) setSelectedGameId(gamesData[0].game_id)
      setLoading(false)
    }
    loadData()
  }, [])

  const selectedGame = useMemo(
    () => games.find((g) => g.game_id === selectedGameId) || null,
    [games, selectedGameId]
  )
  const winnerRow = useMemo(
    () => winnerRows.find((r) => String(r.game_id) === String(selectedGameId)) || null,
    [winnerRows, selectedGameId]
  )
  const totalRow = useMemo(
    () => totalRows.find((r) => String(r.game_id) === String(selectedGameId)) || null,
    [totalRows, selectedGameId]
  )
  const handicapRow = useMemo(
    () => handicapRows.find((r) => String(r.game_id) === String(selectedGameId)) || null,
    [handicapRows, selectedGameId]
  )

  const playersForSelectedGame = useMemo(() => {
    if (!selectedGameId) return []
    const source =
      activePlayerMarket === "pts" ? playerPointsRows :
      activePlayerMarket === "ast" ? playerAssistsRows :
      activePlayerMarket === "reb" ? playerReboundsRows :
      playerThreesRows
    return source
      .filter((p) => String(p.game_id) === String(selectedGameId))
      .filter((p) => (getMinutesAverage(p) ?? 0) >= 20)
      .sort((a, b) => (getProjectionFromPlayer(b) ?? 0) - (getProjectionFromPlayer(a) ?? 0))
  }, [selectedGameId, activePlayerMarket, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows])

  const ranking = useMemo(() => {
    const items: RankingItem[] = []

    for (const jogo of games) {
      const winner = winnerRows.find((r) => String(r.game_id) === String(jogo.game_id))
      const total = totalRows.find((r) => String(r.game_id) === String(jogo.game_id))
      const handicap = handicapRows.find((r) => String(r.game_id) === String(jogo.game_id))

      // Vencedor — usa prob real do banco, igual aos outros mercados
      if (winner) {
        const { probCasa, probFora } = getProjectionFromGameWinner(winner)
        const odds = oddsMap[`winner-${jogo.game_id}`] || {}
        const conf = getModelConfidence(winner) ?? 0
        if (probCasa != null && odds.oddHome) {
          const ev = probCasa * odds.oddHome - 1
          items.push({
            key: `${jogo.game_id}-winner-home`,
            categoria: "Jogo",
            mercado: "Vencedor",
            titulo: `${jogo.casa} ML`,
            subtitulo: `${jogo.casa} vs ${jogo.fora}`,
            lado: jogo.casa,
            odd: odds.oddHome,
            prob: probCasa,
            projecao: probCasa,
            edge: probCasa - 1 / odds.oddHome,
            ev,
            confianca: Math.round((Math.max(ev, 0) * 100 + conf * 0.5) * 10) / 10,
          })
        }
        if (probFora != null && odds.oddAway) {
          const ev = probFora * odds.oddAway - 1
          items.push({
            key: `${jogo.game_id}-winner-away`,
            categoria: "Jogo",
            mercado: "Vencedor",
            titulo: `${jogo.fora} ML`,
            subtitulo: `${jogo.casa} vs ${jogo.fora}`,
            lado: jogo.fora,
            odd: odds.oddAway,
            prob: probFora,
            projecao: probFora,
            edge: probFora - 1 / odds.oddAway,
            ev,
            confianca: Math.round((Math.max(ev, 0) * 100 + conf * 0.5) * 10) / 10,
          })
        }
      }

      if (total) {
        const odds = oddsMap[`total-${jogo.game_id}`] || {}
        items.push(...getLineBetRankingItem({
          keyBase: `total-${jogo.game_id}`,
          mercado: "Total de Pontos",
          titulo: `${jogo.casa} vs ${jogo.fora}`,
          subtitulo: "Mercado de jogos",
          projecao: getProjectionFromGameTotal(total),
          linha: odds.linha, oddOver: odds.oddOver, oddUnder: odds.oddUnder,
          modelConfidence: getModelConfidence(total),
          probOver: null, probUnder: null,
          tipo: "total",
        }))
      }

      if (handicap) {
        const odds = oddsMap[`handicap-${jogo.game_id}`] || {}
        items.push(...getLineBetRankingItem({
          keyBase: `handicap-${jogo.game_id}`,
          mercado: "Handicap",
          titulo: `${jogo.casa} vs ${jogo.fora}`,
          subtitulo: "Mercado de jogos",
          projecao: getProjectionFromGameHandicap(handicap),
          linha: odds.linha, oddOver: odds.oddOver, oddUnder: odds.oddUnder,
          modelConfidence: getModelConfidence(handicap),
          probOver: null, probUnder: null,
          tipo: "handicap",
        }))
      }
    }

    const playerSources = [
      { rows: playerPointsRows, mercado: "Pontos" },
      { rows: playerAssistsRows, mercado: "Assistências" },
      { rows: playerReboundsRows, mercado: "Rebotes" },
      { rows: playerThreesRows, mercado: "Cestas de 3" },
    ]
    for (const source of playerSources) {
      for (const row of source.rows) {
        if ((getMinutesAverage(row) ?? 0) < 20) continue
        const key = `player-${source.mercado}-${row.game_id}-${row.player_id}`
        const odds = oddsMap[key] || {}
        items.push(...getLineBetRankingItem({
          keyBase: key,
          mercado: source.mercado,
          titulo: row.player_name,
          subtitulo: `${getPlayerTeam(row)} vs ${getPlayerOpponent(row)}`,
          projecao: getProjectionFromPlayer(row),
          linha: odds.linha, oddOver: odds.oddOver, oddUnder: odds.oddUnder,
          modelConfidence: getModelConfidence(row),
          probOver: getProbOver(row),
          probUnder: getProbUnder(row),
        }))
      }
    }
    return items.filter((x) => x.odd && x.ev !== null).sort((a, b) => (b.scoreJarvis ?? -999) - (a.scoreJarvis ?? -999))
  }, [games, winnerRows, totalRows, handicapRows, playerPointsRows, playerAssistsRows, playerReboundsRows, playerThreesRows, oddsMap])

  function handleOddsChange(key: string, field: keyof OddsInput, value: string) {
    setOddsMap((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value === "" ? undefined : Number(value) },
    }))
  }

  const fp = (n: number | null | undefined) => n == null ? "—" : `${(n * 100).toFixed(1)}%`
  const fn = (n: number | null | undefined, d = 1) => (n == null || Number.isNaN(n)) ? "—" : Number(n).toFixed(d)
  const evColor = (ev: number | null) => ev == null ? C.textDim : ev > 0.05 ? "#22c55e" : ev > 0 ? "#f59e0b" : "#ef4444"
  const confColor = (c: number | null) => c == null ? C.textDim : c >= 70 ? "#22c55e" : c >= 40 ? "#f59e0b" : C.textDim
  const scoreColor = (s: number | null) => s == null ? C.textDim : s >= 65 ? "#E8B84B" : s >= 45 ? "#C9982A" : C.textMuted

  const S = styles

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.logo}>
            <span style={S.logoJ}>J</span>
            <span style={S.logoText}>ARVIS</span>
          </div>
          <span style={S.headerBadge}>NBA · AO VIVO</span>
        </div>
        <div style={S.headerRight}>
          <div style={S.dot} />
          <span style={S.headerSub}>Hoje</span>
        </div>
      </div>

      {loading ? (
        <div style={S.loadingBar}><div style={S.loadingText}>Carregando dados...</div></div>
      ) : (
        <div style={S.gameSelector}>
          {games.map((game) => {
            const active = selectedGameId === game.game_id
            return (
              <button key={game.game_id} onClick={() => setSelectedGameId(game.game_id)}
                style={{ ...S.gameTab, ...(active ? S.gameTabActive : {}) }}>
                <span style={S.gameTabHome}>{game.casa}</span>
                <span style={S.gameTabVs}>vs</span>
                <span style={S.gameTabAway}>{game.fora}</span>
                {active && <div style={S.gameTabBar} />}
              </button>
            )
          })}
        </div>
      )}

      <div style={S.nav}>
        {(["jogos", "jogadores", "ranking"] as const).map((s) => (
          <button key={s} onClick={() => setActiveSection(s)}
            style={{ ...S.navBtn, ...(activeSection === s ? S.navBtnActive : {}) }}>
            {s === "jogos" ? "Jogos" : s === "jogadores" ? "Jogadores" : "Ranking"}
            {s === "ranking" && ranking.length > 0 && (
              <span style={S.navBadge}>{ranking.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── JOGOS ── */}
      {activeSection === "jogos" && selectedGame && (
        <div style={S.section}>
          <div style={S.marketTabs}>
            {(["winner", "total", "handicap"] as const).map((m) => (
              <button key={m} onClick={() => setActiveGameMarket(m)}
                style={{ ...S.marketTab, ...(activeGameMarket === m ? S.marketTabActive : {}) }}>
                {MARKET_LABELS[m]}
              </button>
            ))}
          </div>

          {activeGameMarket === "winner" && (
            <div style={S.card}>
              {winnerRow ? (() => {
                const { probCasa, probFora } = getProjectionFromGameWinner(winnerRow)
                const conf = getModelConfidence(winnerRow)
                const key = `winner-${selectedGame.game_id}`
                const odds = oddsMap[key] || {}
                const evHome = probCasa != null && odds.oddHome ? probCasa * odds.oddHome - 1 : null
                const evAway = probFora != null && odds.oddAway ? probFora * odds.oddAway - 1 : null
                const favorito = probCasa != null && probFora != null
                  ? (probCasa >= probFora ? selectedGame.casa : selectedGame.fora) : null
                const probFav = probCasa != null && probFora != null ? Math.max(probCasa, probFora) : null
                return (
                  <>
                    <div style={S.cardHeader}>
                      <span style={S.cardLabel}>Vencedor · Moneyline</span>
                      {conf != null && <span style={{ ...S.confBadge, color: confColor(conf) }}>Conf {fn(conf, 0)}</span>}
                    </div>
                    {favorito && (
                      <div style={S.favoritoBanner}>
                        <span style={S.favoritoLabel}>FAVORITO JARVIS</span>
                        <span style={S.favoritoName}>{favorito}</span>
                        <span style={S.favoritoProb}>{fp(probFav)}</span>
                      </div>
                    )}
                    <div style={S.winnerGrid}>
                      <div style={S.winnerSide}>
                        <div style={S.winnerTeam}>{selectedGame.casa}</div>
                        <div style={S.winnerProb}>{fp(probCasa)}</div>
                        <div style={S.probBar}>
                          <div style={{ ...S.probFill, width: `${(probCasa ?? 0) * 100}%`, background: C.gold }} />
                        </div>
                      </div>
                      <div style={S.winnerDivider}><span style={S.winnerVs}>VS</span></div>
                      <div style={{ ...S.winnerSide, alignItems: "flex-end" as any }}>
                        <div style={S.winnerTeam}>{selectedGame.fora}</div>
                        <div style={S.winnerProb}>{fp(probFora)}</div>
                        <div style={S.probBar}>
                          <div style={{ ...S.probFill, width: `${(probFora ?? 0) * 100}%`, background: C.goldDim, marginLeft: "auto" }} />
                        </div>
                      </div>
                    </div>
                    <div style={S.oddsRow}>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.casa}</div>
                        <input type="number" step="0.01" placeholder="Odd"
                          value={odds.oddHome ?? ""} onChange={(e) => handleOddsChange(key, "oddHome", e.target.value)}
                          style={S.oddInput} />
                        {evHome != null && <div style={{ ...S.evTag, color: evColor(evHome) }}>EV {evHome > 0 ? "+" : ""}{(evHome * 100).toFixed(1)}%</div>}
                        {probCasa != null && <div style={S.probMini}>Prob Jarvis: {fp(probCasa)}</div>}
                      </div>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.fora}</div>
                        <input type="number" step="0.01" placeholder="Odd"
                          value={odds.oddAway ?? ""} onChange={(e) => handleOddsChange(key, "oddAway", e.target.value)}
                          style={S.oddInput} />
                        {evAway != null && <div style={{ ...S.evTag, color: evColor(evAway) }}>EV {evAway > 0 ? "+" : ""}{(evAway * 100).toFixed(1)}%</div>}
                        {probFora != null && <div style={S.probMini}>Prob Jarvis: {fp(probFora)}</div>}
                      </div>
                    </div>
                  </>
                )
              })() : <div style={S.empty}>Sem dados para este jogo.</div>}
            </div>
          )}

          {activeGameMarket === "total" && (
            <div style={S.card}>
              {totalRow ? (() => {
                const proj = getProjectionFromGameTotal(totalRow)
                const conf = getModelConfidence(totalRow)
                const key = `total-${selectedGame.game_id}`
                const odds = oddsMap[key] || {}
                const evOver = odds.linha && odds.oddOver && proj != null ? calcularEvOver(proj, odds.linha, odds.oddOver, "total") : null
                const evUnder = odds.linha && odds.oddUnder && proj != null ? calcularEvUnder(proj, odds.linha, odds.oddUnder, "total") : null




                return (
                  <>
                    <div style={S.cardHeader}>
                      <span style={S.cardLabel}>Total de Pontos</span>
                      {conf != null && <span style={{ ...S.confBadge, color: confColor(conf) }}>Conf {fn(conf, 0)}</span>}
                    </div>
                    <div style={S.projCenter}>
                      <div style={S.projBig}>{fn(proj, 1)}</div>
                      <div style={S.projSub}>Projeção Jarvis</div>
                    </div>
                    <div style={S.lineRow}>
                      <input type="number" step="0.5" placeholder="Linha da banca"
                        value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                        style={{ ...S.oddInput, flex: 1 }} />
                    </div>
                    <div style={S.oddsRow}>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>Over</div>
                        <input type="number" step="0.01" placeholder="Odd"
                          value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={S.oddInput} />
                        {evOver != null && <div style={{ ...S.evTag, color: evColor(evOver) }}>EV {evOver > 0 ? "+" : ""}{(evOver * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>Under</div>
                        <input type="number" step="0.01" placeholder="Odd"
                          value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={S.oddInput} />
                        {evUnder != null && <div style={{ ...S.evTag, color: evColor(evUnder) }}>EV {evUnder > 0 ? "+" : ""}{(evUnder * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </>
                )
              })() : <div style={S.empty}>Sem dados para este jogo.</div>}
            </div>
          )}

          {activeGameMarket === "handicap" && (
            <div style={S.card}>
              {handicapRow ? (() => {
                const proj = getProjectionFromGameHandicap(handicapRow)
                const conf = getModelConfidence(handicapRow)
                const key = `handicap-${selectedGame.game_id}`
                const odds = oddsMap[key] || {}
                const evOver = odds.linha && odds.oddOver && proj != null ? calcularEvOver(proj, odds.linha, odds.oddOver, "handicap") : null
                const evUnder = odds.linha && odds.oddUnder && proj != null ? calcularEvUnder(proj, odds.linha, odds.oddUnder, "handicap") : null





                // predicted_point_diff = pontos_casa - pontos_fora
                // proj > 0 → Jarvis projeta vitória do mandante → mandante é favorito (spread negativo)
                // proj < 0 → Jarvis projeta vitória do visitante → visitante é favorito (spread negativo)
                const favorito = proj != null ? (proj > 0 ? selectedGame.casa : selectedGame.fora) : "—"
                const spreadFav = proj != null ? `-${Math.abs(proj).toFixed(1)}` : ""
                const spreadAz  = proj != null ? `+${Math.abs(proj).toFixed(1)}` : ""
                // Casa recebe spread negativo se proj > 0 (favorito), positivo se proj < 0 (azarão)
                const spreadCasa = proj != null ? (proj > 0 ? `-${Math.abs(proj).toFixed(1)}` : `+${Math.abs(proj).toFixed(1)}`) : ""
                const spreadFora = proj != null ? (proj < 0 ? `-${Math.abs(proj).toFixed(1)}` : `+${Math.abs(proj).toFixed(1)}`) : ""

                return (
                  <>
                    <div style={S.cardHeader}>
                      <span style={S.cardLabel}>Handicap · Spread</span>
                      {conf != null && <span style={{ ...S.confBadge, color: confColor(conf) }}>Conf {fn(conf, 0)}</span>}
                    </div>
                    <div style={S.projCenter}>
                      <div style={S.projBig}>{spreadFav}</div>
                      <div style={S.projSub}>
                        Favorito: <strong style={{ color: C.gold }}>{favorito}</strong>
                      </div>
                    </div>
                    <div style={S.lineRow}>
                      <input type="number" step="0.5" placeholder="Linha da banca"
                        value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                        style={{ ...S.oddInput, flex: 1 }} />
                    </div>
                    <div style={S.oddsRow}>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.casa} {spreadCasa}</div>
                        <input type="number" step="0.01" placeholder="Odd"
                          value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={S.oddInput} />
                        {evOver != null && <div style={{ ...S.evTag, color: evColor(evOver) }}>EV {evOver > 0 ? "+" : ""}{(evOver * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.oddGroup}>
                        <div style={S.oddLabel}>{selectedGame.fora} {spreadFora}</div>
                        <input type="number" step="0.01" placeholder="Odd"
                          value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={S.oddInput} />
                        {evUnder != null && <div style={{ ...S.evTag, color: evColor(evUnder) }}>EV {evUnder > 0 ? "+" : ""}{(evUnder * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </>
                )
              })() : <div style={S.empty}>Sem dados para este jogo.</div>}
            </div>
          )}
        </div>
      )}

      {/* ── JOGADORES ── */}
      {activeSection === "jogadores" && selectedGame && (
        <div style={S.section}>
          <div style={S.playerMarketTabs}>
            {(["pts", "ast", "reb", "fg3m"] as const).map((m) => (
              <button key={m} onClick={() => setActivePlayerMarket(m)}
                style={{ ...S.playerMarketTab, ...(activePlayerMarket === m ? S.playerMarketTabActive : {}) }}>
                {PLAYER_LABELS[m]}
              </button>
            ))}
          </div>
          <div style={S.filterNote}>Filtro: média ≥ 20 min · {playersForSelectedGame.length} jogadores</div>
          {playersForSelectedGame.length === 0 ? (
            <div style={S.empty}>Nenhum jogador encontrado.</div>
          ) : (
            <div style={S.playerList}>
              {playersForSelectedGame.map((player) => {
                const key = `player-${PLAYER_LABELS[activePlayerMarket]}-${player.game_id}-${player.player_id}`
                const odds = oddsMap[key] || {}
                const proj = getProjectionFromPlayer(player)
                const probOver = getProbOver(player)
                const probUnder = getProbUnder(player)
                const conf = getModelConfidence(player)
                const evO = calcularEvLocal(probOver, odds.oddOver ?? null)
                const evU = calcularEvLocal(probUnder, odds.oddUnder ?? null)
                return (
                  <div key={key} style={S.playerRow}>
                    <div style={S.playerInfo}>
                      <div style={S.playerName}>{player.player_name}</div>
                      <div style={S.playerMeta}>
                        <span style={S.playerTeam}>{getPlayerTeam(player)}</span>
                        <span style={S.playerVs}>vs {getPlayerOpponent(player)}</span>
                      </div>
                    </div>
                    <div style={S.playerStats}>
                      <div style={S.statPill}>
                        <span style={S.statLabel}>Proj</span>
                        <span style={S.statValue}>{fn(proj, 1)}</span>
                      </div>
                      <div style={S.statPill}>
                        <span style={S.statLabel}>Min</span>
                        <span style={S.statValue}>{fn(getMinutesAverage(player), 0)}</span>
                      </div>
                      {probOver != null && (
                        <div style={S.statPill}>
                          <span style={S.statLabel}>P↑</span>
                          <span style={S.statValue}>{fp(probOver)}</span>
                        </div>
                      )}
                      {conf != null && (
                        <div style={{ ...S.statPill, borderColor: confColor(conf) }}>
                          <span style={S.statLabel}>Conf</span>
                          <span style={{ ...S.statValue, color: confColor(conf) }}>{fn(conf, 0)}</span>
                        </div>
                      )}
                    </div>
                    <div style={S.playerOddsRow}>
                      <input type="number" step="0.5" placeholder="Linha"
                        value={odds.linha ?? ""} onChange={(e) => handleOddsChange(key, "linha", e.target.value)}
                        style={S.playerInput} />
                      <div style={S.playerOddGroup}>
                        <input type="number" step="0.01" placeholder="Over"
                          value={odds.oddOver ?? ""} onChange={(e) => handleOddsChange(key, "oddOver", e.target.value)}
                          style={S.playerInput} />
                        {evO != null && <div style={{ ...S.evMini, color: evColor(evO) }}>{evO > 0 ? "+" : ""}{(evO * 100).toFixed(1)}%</div>}
                      </div>
                      <div style={S.playerOddGroup}>
                        <input type="number" step="0.01" placeholder="Under"
                          value={odds.oddUnder ?? ""} onChange={(e) => handleOddsChange(key, "oddUnder", e.target.value)}
                          style={S.playerInput} />
                        {evU != null && <div style={{ ...S.evMini, color: evColor(evU) }}>{evU > 0 ? "+" : ""}{(evU * 100).toFixed(1)}%</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── RANKING ── */}
      {activeSection === "ranking" && (
        <div style={S.section}>
          {ranking.length === 0 ? (
            <div style={S.emptyRanking}>
              <div style={S.emptyIcon}>⚡</div>
              <div style={S.emptyTitle}>Sem apostas calculadas</div>
              <div style={S.emptySub}>Preencha linhas e odds nos mercados para ver o ranking.</div>
            </div>
          ) : (
            <div style={S.rankList}>
              {ranking.map((item, i) => (
                <div key={item.key} style={S.rankRow}>
                  <div style={S.rankPos}>#{i + 1}</div>
                  <div style={S.rankInfo}>
                    <div style={S.rankTitle}>{item.titulo}</div>
                    <div style={S.rankMeta}>
                      <span style={S.rankMercado}>{item.mercado}</span>
                      <span style={S.rankSub}>{item.subtitulo}</span>
                    </div>
                    <div style={S.rankStats}>
                      <span style={S.rankStat}><span style={S.rankStatLabel}>Lado</span> {item.lado}</span>
                      <span style={S.rankStat}><span style={S.rankStatLabel}>Prob</span> {fp(item.prob)}</span>
                      <span style={S.rankStat}><span style={S.rankStatLabel}>Odd</span> {fn(item.odd, 2)}</span>
                      <span style={S.rankStat}><span style={S.rankStatLabel}>Edge</span> {fn(item.edge, 3)}</span>
                    </div>
                  </div>
                  <div style={S.rankEvCol}>
                    <div style={{ ...S.rankEv, color: evColor(item.ev) }}>
                      {item.ev != null ? `${item.ev > 0 ? "+" : ""}${(item.ev * 100).toFixed(1)}%` : "—"}
                    </div>
                    <div style={S.rankEvLabel}>EV</div>
                    {item.scoreJarvis != null && (
                      <div style={S.rankScoreBadge}>
                        <span style={{ ...S.rankScoreValue, color: scoreColor(item.scoreJarvis) }}>
                          {item.scoreJarvis.toFixed(0)}
                        </span>
                        <span style={S.rankScoreLabel}>SCORE</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const C = {
  bg:           "#080600",
  surface:      "#0E0B04",
  surface2:     "#14100A",
  surfaceRaised:"#1A1409",
  border:       "#2A2010",
  border2:      "#3A2D14",
  gold:         "#C9982A",
  goldLight:    "#E8B84B",
  goldDim:      "#8B6514",
  goldBg:       "#1A1205",
  goldAccent:   "#C9982A22",
  text:         "#EDE0C4",
  textMuted:    "#8A7355",
  textDim:      "#4A3C28",
  white:        "#FAF0DC",
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: "'SF Pro Display', 'Helvetica Neue', sans-serif",
    fontSize: 14,
    paddingBottom: 40,
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 16px 12px",
    borderBottom: `1px solid ${C.border2}`,
    background: C.surface,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  logo: { display: "flex", alignItems: "baseline", gap: 2 },
  logoJ: { fontSize: 22, fontWeight: 800, color: C.gold, letterSpacing: "-0.5px", textShadow: `0 0 12px ${C.goldDim}` },
  logoText: { fontSize: 15, fontWeight: 700, color: C.white, letterSpacing: "3px" },
  headerBadge: {
    fontSize: 10, fontWeight: 700, color: C.gold,
    background: C.goldAccent, border: `1px solid ${C.goldDim}`,
    borderRadius: 4, padding: "2px 7px", letterSpacing: "0.5px",
  },
  headerRight: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: "50%", background: C.gold, boxShadow: `0 0 6px ${C.gold}` },
  headerSub: { fontSize: 12, color: C.textMuted },

  loadingBar: { padding: "20px 16px", borderBottom: `1px solid ${C.border}` },
  loadingText: { color: C.textMuted, fontSize: 13 },

  gameSelector: {
    display: "flex", borderBottom: `1px solid ${C.border2}`,
    background: C.surface, overflowX: "auto" as any,
  },
  gameTab: {
    position: "relative",
    display: "flex", flexDirection: "column" as any, alignItems: "center", gap: 2,
    padding: "10px 16px 8px", background: "none", border: "none",
    cursor: "pointer", minWidth: 120, color: C.textMuted, transition: "color 0.15s",
  },
  gameTabActive: { color: C.gold },
  gameTabHome: { fontSize: 13, fontWeight: 700 },
  gameTabVs: { fontSize: 10, color: C.textDim },
  gameTabAway: { fontSize: 13, fontWeight: 700 },
  gameTabBar: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
    background: C.gold, borderRadius: "2px 2px 0 0", boxShadow: `0 0 8px ${C.gold}`,
  },

  nav: { display: "flex", background: C.surface, borderBottom: `1px solid ${C.border2}` },
  navBtn: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "10px 8px", background: "none", border: "none", cursor: "pointer",
    color: C.textMuted, fontSize: 13, fontWeight: 500, letterSpacing: "0.3px", transition: "color 0.15s",
  },
  navBtnActive: { color: C.gold },
  navBadge: {
    fontSize: 10, fontWeight: 700, color: C.bg, background: C.gold,
    borderRadius: 10, padding: "1px 5px", minWidth: 16, textAlign: "center" as any,
  },

  section: { padding: "12px 12px 0" },

  marketTabs: { display: "flex", gap: 6, marginBottom: 10 },
  marketTab: {
    flex: 1, padding: "8px 4px", background: C.surface2,
    border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer",
    color: C.textMuted, fontSize: 12, fontWeight: 600, letterSpacing: "0.3px",
    textAlign: "center" as any, transition: "all 0.15s",
  },
  marketTabActive: {
    background: C.goldBg, border: `1px solid ${C.gold}`,
    color: C.gold, boxShadow: `0 0 8px ${C.goldDim}`,
  },

  card: {
    background: C.surfaceRaised, border: `1px solid ${C.border2}`,
    borderRadius: 12, padding: "14px 14px 12px", marginBottom: 10,
  },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cardLabel: { fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "1px" },
  confBadge: { fontSize: 11, fontWeight: 600 },

  favoritoBanner: {
    display: "flex", alignItems: "center", gap: 8,
    background: C.goldBg, border: `1px solid ${C.goldDim}`,
    borderRadius: 8, padding: "8px 12px", marginBottom: 14,
  },
  favoritoLabel: { fontSize: 9, fontWeight: 700, color: C.goldDim, letterSpacing: "1px", textTransform: "uppercase" as any },
  favoritoName: { fontSize: 14, fontWeight: 800, color: C.gold, flex: 1 },
  favoritoProb: { fontSize: 16, fontWeight: 800, color: C.goldLight },

  winnerGrid: { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 14 },
  winnerSide: { display: "flex", flexDirection: "column" as any, gap: 4 },
  winnerTeam: { fontSize: 14, fontWeight: 700, color: C.text },
  winnerProb: { fontSize: 20, fontWeight: 800, color: C.gold },
  winnerDivider: { display: "flex", alignItems: "center", justifyContent: "center" },
  winnerVs: { fontSize: 10, fontWeight: 700, color: C.textDim, letterSpacing: "2px" },
  probBar: { height: 3, background: C.border2, borderRadius: 2, overflow: "hidden", width: "100%" },
  probFill: { height: "100%", borderRadius: 2, transition: "width 0.3s" },
  probMini: { fontSize: 10, color: C.textMuted, marginTop: 2 },

  projCenter: { textAlign: "center" as any, marginBottom: 14, padding: "8px 0" },
  projBig: { fontSize: 36, fontWeight: 800, color: C.gold, letterSpacing: "-1px", textShadow: `0 0 20px ${C.goldDim}` },
  projSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  lineRow: { display: "flex", marginBottom: 10 },

  oddsRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  oddGroup: { display: "flex", flexDirection: "column" as any, gap: 4 },
  oddLabel: { fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase" as any, letterSpacing: "0.8px" },
  oddInput: {
    width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
    borderRadius: 6, color: C.text, fontSize: 13, padding: "7px 10px",
    outline: "none", boxSizing: "border-box" as any, fontFamily: "inherit",
  },
  evTag: { fontSize: 11, fontWeight: 700 },

  playerMarketTabs: { display: "flex", gap: 6, marginBottom: 8 },
  playerMarketTab: {
    flex: 1, padding: "6px 4px", background: C.surface2, border: `1px solid ${C.border}`,
    borderRadius: 6, cursor: "pointer", color: C.textMuted, fontSize: 11,
    fontWeight: 600, letterSpacing: "0.3px", textAlign: "center" as any, transition: "all 0.15s",
  },
  playerMarketTabActive: { background: C.goldBg, border: `1px solid ${C.gold}`, color: C.gold },
  filterNote: { fontSize: 11, color: C.textDim, marginBottom: 8 },

  playerList: { display: "flex", flexDirection: "column" as any, gap: 6 },
  playerRow: { background: C.surfaceRaised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" },
  playerInfo: { marginBottom: 8 },
  playerName: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 2 },
  playerMeta: { display: "flex", gap: 6, alignItems: "center" },
  playerTeam: { fontSize: 10, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 4, padding: "1px 5px" },
  playerVs: { fontSize: 10, color: C.textMuted },
  playerStats: { display: "flex", gap: 6, flexWrap: "wrap" as any, marginBottom: 8 },
  statPill: {
    display: "flex", flexDirection: "column" as any, alignItems: "center",
    background: C.surface2, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: "4px 8px", minWidth: 44,
  },
  statLabel: { fontSize: 9, color: C.textMuted, fontWeight: 600, letterSpacing: "0.5px" },
  statValue: { fontSize: 12, fontWeight: 700, color: C.text },
  playerOddsRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 },
  playerOddGroup: { display: "flex", flexDirection: "column" as any, gap: 2 },
  playerInput: {
    width: "100%", background: C.surface2, border: `1px solid ${C.border2}`,
    borderRadius: 5, color: C.text, fontSize: 12, padding: "5px 7px",
    outline: "none", boxSizing: "border-box" as any, fontFamily: "inherit",
  },
  evMini: { fontSize: 10, fontWeight: 700, textAlign: "center" as any },

  rankList: { display: "flex", flexDirection: "column" as any, gap: 6 },
  rankScoreBadge: {
    display: "flex", flexDirection: "column" as any, alignItems: "center",
    marginTop: 6, padding: "4px 8px",
    background: "#1A1205", border: "1px solid #3A2D14",
    borderRadius: 6,
  },
  rankScoreValue: { fontSize: 15, fontWeight: 800 },
  rankScoreLabel: { fontSize: 8, fontWeight: 700, color: "#4A3C28", letterSpacing: "1px" },
  rankRow: {
    display: "flex", alignItems: "flex-start", gap: 10,
    background: C.surfaceRaised, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: "10px 12px",
  },
  rankPos: { fontSize: 11, fontWeight: 800, color: C.goldDim, minWidth: 24, paddingTop: 2 },
  rankInfo: { flex: 1, minWidth: 0 },
  rankTitle: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as any },
  rankMeta: { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 },
  rankMercado: { fontSize: 9, fontWeight: 700, color: C.bg, background: C.gold, borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" as any, letterSpacing: "0.5px" },
  rankSub: { fontSize: 10, color: C.textMuted },
  rankStats: { display: "flex", gap: 8, flexWrap: "wrap" as any },
  rankStat: { fontSize: 11, color: C.textMuted },
  rankStatLabel: { color: C.textDim, marginRight: 2 },
  rankEvCol: { display: "flex", flexDirection: "column" as any, alignItems: "flex-end", gap: 2, paddingTop: 2 },
  rankEv: { fontSize: 16, fontWeight: 800 },
  rankEvLabel: { fontSize: 9, fontWeight: 600, color: C.textDim, letterSpacing: "1px" },

  empty: { padding: "20px 0", color: C.textMuted, fontSize: 13, textAlign: "center" as any },
  emptyRanking: { padding: "48px 20px", textAlign: "center" as any },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: 700, color: C.gold, marginBottom: 6 },
  emptySub: { fontSize: 12, color: C.textMuted, lineHeight: 1.6 },
}
