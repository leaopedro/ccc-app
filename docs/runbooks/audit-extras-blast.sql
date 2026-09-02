-- Auditoria: TicketExtraItem revogado por engano pelo bug de escopo do revoke.
-- Somente leitura. Rodar em producao ANTES de qualquer correcao de dados.
--
-- O bug: revokeExtrasOnlyItems casava so em extraId, sem escopo de ticket,
-- pedido ou usuario. TicketExtra e por EVENTO, entao reembolsar um pedido
-- extras_only (ou mixed sem ticket proprio) revogava aquele extra de TODOS os
-- compradores do evento.
--
-- ============================================================
-- CONSULTA 1 (PRIMARIA): clusters. E a assinatura do estrago.
-- ============================================================
-- Um reembolso legitimo mexe em uma ou duas linhas. Um blast mexe em uma linha
-- por comprador daquele extra, todas no mesmo segundo. Procure grupos grandes.
SELECT
  te."eventId",
  te.name                                   AS extra,
  date_trunc('second', tei."updatedAt")     AS revoked_at,
  count(*)                                  AS linhas_revogadas,
  count(*) FILTER (WHERE t.status = 'valid') AS com_ticket_ainda_valido
FROM "TicketExtraItem" tei
JOIN "Ticket" t       ON t.id  = tei."ticketId"
JOIN "TicketExtra" te ON te.id = tei."extraId"
WHERE tei.status = 'revoked'
GROUP BY 1, 2, 3
HAVING count(*) > 2
ORDER BY linhas_revogadas DESC, revoked_at DESC;

-- ============================================================
-- CONSULTA 2 (FILTRO): as vitimas provaveis, linha a linha.
-- ============================================================
-- Sinal mais forte: o item esta revogado mas o TICKET dele continua valido.
-- Revogacao legitima passa por revokeOwnedTickets, que derruba ticket e itens
-- juntos. Item revogado sob ticket valido nao deveria existir.
SELECT
  tei.id            AS ticket_extra_item_id,
  tei."updatedAt"   AS revoked_at,
  t."userId",
  te."eventId",
  te.name           AS extra
FROM "TicketExtraItem" tei
JOIN "Ticket" t       ON t.id  = tei."ticketId"
JOIN "TicketExtra" te ON te.id = tei."extraId"
WHERE tei.status = 'revoked'
  AND t.status = 'valid'
  AND NOT EXISTS (
    SELECT 1
    FROM "Order" o
    JOIN "OrderExtra" oe ON oe."orderId" = o.id
    WHERE oe."extraId" = tei."extraId"
      AND o."userId"   = t."userId"
      AND o.status IN ('refunded', 'cancelled', 'expired')
  )
ORDER BY tei."updatedAt";

-- ============================================================
-- CONSULTA 3: quem disparou. Correlacionar cluster com o reembolso.
-- ============================================================
-- Trocar o intervalo pelo revoked_at de um cluster da consulta 1.
SELECT a."createdAt", a."actorId", a."entityId" AS order_id, a.metadata
FROM "AdminAudit" a
WHERE a.action = 'order.refund_requested'
  AND a."createdAt" BETWEEN :inicio AND :fim
ORDER BY a."createdAt";

-- ============================================================
-- LER ANTES DE AGIR
-- ============================================================
-- Falsos POSITIVOS que a consulta 2 produz, todos legitimos:
--   * revogacao manual por admin e varredura de evento cancelado
--   * itens em ticket de cortesia, sem Order nenhum, entao o NOT EXISTS passa
--     de graca
--   * ticket revogado e depois restaurado para valid, deixando itens revogados
--   * reembolso Pix/AbacatePay, se liquidar por outro caminho
--
-- Falso NEGATIVO importante: uma vitima real que TAMBEM tenha um reembolso
-- proprio daquele extra fica escondida pelo NOT EXISTS. Por isso a consulta 1
-- e a primaria e a 2 e so o filtro.
--
-- Nao existe reversao automatica segura. Voltar um item para 'valid' devolve
-- acesso a um bem que pode ter sido legitimamente reembolsado. Decidir cluster
-- por cluster, com o reembolso da consulta 3 na mao.
