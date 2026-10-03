import test from 'node:test'
import assert from 'node:assert/strict'
import { segments } from './highlight.js'

const text = 'Rahul Sharma, 98765 43210, here to meet Dr Aggarwal'

test('underlines the words each field came from, in order', () => {
  const s = segments(text, {
    name: { evidence: 'Rahul Sharma', status: 'ok' },
    phone: { evidence: '98765 43210', status: 'ok' },
    host: { evidence: 'Dr Aggarwal', status: 'ok' },
  })
  assert.deepEqual(s.filter((x) => x.field).map((x) => x.field), ['name', 'phone', 'host'])
  assert.equal(s.map((x) => x.text).join(''), text) // nothing lost, nothing duplicated
})

test('ignores missing fields and evidence that is not in the sentence', () => {
  const s = segments(text, { purpose: { evidence: null, status: 'missing' }, host: { evidence: 'Dr Verma', status: 'ungrounded' } })
  assert.equal(s.length, 1)
  assert.equal(s[0].field, undefined)
})

test('overlapping evidence does not duplicate text', () => {
  const s = segments(text, { name: { evidence: 'Rahul Sharma', status: 'ok' }, host: { evidence: 'Sharma, 98765', status: 'ok' } })
  assert.equal(s.map((x) => x.text).join(''), text)
})

test('works with Hindi text', () => {
  const t = 'राहुल शर्मा, ९८७६५४३२१०'
  const s = segments(t, { name: { evidence: 'राहुल शर्मा', status: 'unverified' } })
  assert.equal(s[0].field, 'name')
  assert.equal(s.map((x) => x.text).join(''), t)
})
