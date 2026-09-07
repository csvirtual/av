// Fase 5 (compras/financeiro): fornecedores — CRUD simples, mesmo padrão de
// routes/customers.js só que sem extrato (fornecedor não tem "saldo", quem
// tem é a conta a pagar vinculada a ele em routes/finance.js).
import { Router } from 'express';
import { db } from '../db/index.js';
import { broadcast } from '../lib/broadcast.js';

const router = Router();

const insertStmt = db.prepare('INSERT INTO suppliers (id, name_lower, data) VALUES (@id, @nameLower, @data)');
const updateStmt = db.prepare('UPDATE suppliers SET name_lower = @nameLower, data = @data WHERE id = @id');
const deleteStmt = db.prepare('DELETE FROM suppliers WHERE id = ?');
const getStmt = db.prepare('SELECT data FROM suppliers WHERE id = ?');
const listStmt = db.prepare('SELECT data FROM suppliers');

function rowToSupplier(row) { return JSON.parse(row.data); }

router.get('/', (req, res) => {
  const suppliers = listStmt.all().map(rowToSupplier).sort((a, b) => a.nameLower.localeCompare(b.nameLower, 'pt-BR'));
  res.json({ suppliers });
});

router.get('/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  res.json({ supplier: rowToSupplier(row) });
});

router.post('/', (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) throw new Error('Nome do fornecedor é obrigatório.');
    const supplier = {
      id: crypto.randomUUID(),
      nome,
      nameLower: nome.toLowerCase(),
      telefone: (req.body.telefone || '').trim(),
      email: (req.body.email || '').trim(),
      documento: (req.body.documento || '').trim(),
      endereco: (req.body.endereco || '').trim(),
      observacoes: (req.body.observacoes || '').trim(),
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    insertStmt.run({ id: supplier.id, nameLower: supplier.nameLower, data: JSON.stringify(supplier) });
    broadcast('suppliers-changed', { reason: 'created', id: supplier.id });
    res.status(201).json({ supplier });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  try {
    const supplier = rowToSupplier(row);
    const body = req.body;
    if (body.nome !== undefined) {
      const nome = body.nome.trim();
      if (!nome) throw new Error('Nome do fornecedor é obrigatório.');
      supplier.nome = nome;
      supplier.nameLower = nome.toLowerCase();
    }
    if (body.telefone !== undefined) supplier.telefone = body.telefone.trim();
    if (body.email !== undefined) supplier.email = body.email.trim();
    if (body.documento !== undefined) supplier.documento = body.documento.trim();
    if (body.endereco !== undefined) supplier.endereco = body.endereco.trim();
    if (body.observacoes !== undefined) supplier.observacoes = body.observacoes.trim();
    if (body.active !== undefined) supplier.active = !!body.active;
    supplier.updatedAt = Date.now();
    updateStmt.run({ id: supplier.id, nameLower: supplier.nameLower, data: JSON.stringify(supplier) });
    broadcast('suppliers-changed', { reason: 'updated', id: supplier.id });
    res.json({ supplier });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
  deleteStmt.run(req.params.id);
  broadcast('suppliers-changed', { reason: 'deleted', id: req.params.id });
  res.json({ ok: true });
});

export default router;
