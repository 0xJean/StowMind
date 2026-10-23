const { sha256, event } = require('./replace-release-local.cjs')

class ReplacementRemote {
  constructor(options, local, journal) {
    this.options = options; this.local = local; this.journal = journal
    this.repo = { owner: options.context.repo.owner, repo: options.context.repo.repo }
    this.api = options.github.rest.repos
  }
  record(action, detail) { if (this.journal) event(this.local.backupDir, this.journal, action, detail) }
  async tag() {
    const ref = (await this.options.github.rest.git.getRef({ ...this.repo, ref: `tags/${this.options.tagName}` })).data
    if (ref.object?.sha !== this.options.expectedTagOid) throw new Error('Original tag object changed; replacement is forbidden.')
    let object = ref.object
    for (let depth = 0; object.type === 'tag' && depth < 8; depth += 1) object = (await this.options.github.rest.git.getTag({ ...this.repo, tag_sha: object.sha })).data.object
    if (object.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('The original tag does not resolve to a commit.')
    return { ref, commit: object.sha }
  }
  async release() {
    const value = (await this.api.getRelease({ ...this.repo, release_id: this.options.expectedReleaseId })).data
    if (value.id !== this.options.expectedReleaseId || value.tag_name !== this.options.tagName || value.draft !== false || value.prerelease !== false || value.immutable !== false) throw new Error('Expected the exact mutable, stable, public release; refusing mutation.')
    return value
  }
  async assets() {
    const all = []
    for await (const page of this.options.github.paginate.iterator(this.api.listReleaseAssets, { ...this.repo, release_id: this.options.expectedReleaseId, per_page: 100 })) all.push(...page.data)
    return all
  }
  async download(assetId) {
    const response = await this.api.getReleaseAsset({ ...this.repo, asset_id: assetId, headers: { accept: 'application/octet-stream' } })
    const data = response.data
    if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error(`Asset ${assetId} download did not return bytes.`)
    return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength)
  }
  async verify(spec, allowedNames) {
    if (!Number.isSafeInteger(spec.id) || spec.id <= 0) throw new Error('A verified asset ID is required.')
    const matches = (await this.assets()).filter((asset) => asset.id === spec.id)
    if (matches.length !== 1 || !allowedNames.includes(matches[0].name)) throw new Error(`Asset ${spec.id} identity/name drift; manual recovery is required.`)
    const asset = matches[0]
    if (asset.digest && asset.digest !== `sha256:${spec.sha256}`) throw new Error(`Asset ${spec.id} metadata digest changed.`)
    const bytes = await this.download(spec.id)
    if (sha256(bytes) !== spec.sha256 || bytes.length !== spec.size || (asset.size != null && asset.size !== bytes.length)) throw new Error(`Asset ${spec.id} bytes do not match the recorded digest/size.`)
    return { asset, bytes }
  }
  async upload(spec, bytes) {
    await this.release()
    if ((await this.assets()).some((asset) => asset.name === spec.name)) throw new Error(`Transaction asset name collision: ${spec.name}`)
    if (sha256(bytes) !== spec.sha256 || bytes.length !== spec.size) throw new Error('Local transaction asset changed before upload.')
    this.record('upload-intent', { name: spec.name, sha256: spec.sha256 })
    let failure
    try {
      await this.api.uploadReleaseAsset({ ...this.repo, release_id: this.options.expectedReleaseId, name: spec.name,
        headers: { 'content-type': 'application/octet-stream', 'content-length': bytes.length }, data: bytes })
    } catch (cause) { failure = cause }
    // Even a successful response is not proof: read the actual uploaded bytes.
    const found = (await this.assets()).filter((asset) => asset.name === spec.name)
    if (found.length !== 1) throw failure ?? new Error(`Unable to identify uploaded asset ${spec.name}.`)
    const candidate = { ...spec, id: found[0].id }
    await this.verify(candidate, [spec.name])
    spec.id = candidate.id
    this.record('upload-verified', { id: spec.id, name: spec.name, sha256: spec.sha256, responseLost: Boolean(failure) })
    return spec
  }
  async rename(spec, target, allowedNames) {
    await this.release()
    const { asset } = await this.verify(spec, allowedNames)
    if (asset.name === target) return
    if ((await this.assets()).some((entry) => entry.name === target && entry.id !== spec.id)) throw new Error(`Refusing to overwrite an unknown asset named ${target}.`)
    this.record('rename-intent', { id: spec.id, from: asset.name, to: target, sha256: spec.sha256 })
    let failure
    try { await this.api.updateReleaseAsset({ ...this.repo, asset_id: spec.id, name: target }) } catch (cause) { failure = cause }
    try { await this.verify(spec, [target]) } catch (cause) { throw failure ?? cause }
    this.record('rename-verified', { id: spec.id, to: target, responseLost: Boolean(failure) })
  }
  async body(target, allowed) {
    const release = await this.release()
    if (!allowed.includes(release.body ?? '')) throw new Error('Release notes changed outside this transaction; manual recovery is required.')
    if ((release.body ?? '') === target) return
    this.record('notes-intent', { body: target })
    let failure
    try { await this.api.updateRelease({ ...this.repo, release_id: release.id, body: target }) } catch (cause) { failure = cause }
    if (((await this.release()).body ?? '') !== target) throw failure ?? new Error('Release notes update could not be verified.')
    this.record('notes-verified', { responseLost: Boolean(failure) })
  }
}

module.exports = { ReplacementRemote }
