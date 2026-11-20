window.__ModuleLoader__.load({
  id: '@zhengrenwritecode/dsh-session-forging',
  factory(require) {
    const React = require('react'),
      h = React.createElement;
    const { Button, Menu, Modal, Toast, Tooltip, IconChevronDownOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
    const field = (label, control, hint) =>
      h(
        'label',
        { className: 'sf-field' },
        h('span', null, label),
        React.cloneElement(control, { 'aria-label': control.props['aria-label'] ?? label }),
        hint ? h('small', null, hint) : null
      );
    const section = (title, ...children) =>
      h('section', { className: 'sf-section' }, h('h2', null, title), ...children);
    const choices = (value, onChange, items, label) =>
      h(
        'select',
        { value, onChange: (e) => onChange(e.target.value), 'aria-label': label },
        items.map(([id, text]) => h('option', { key: id, value: id }, text))
      );
    const councilTypes = {
      prd: 'PRD',
      spec: 'Spec',
      design: 'Design Doc',
      rfc: 'RFC',
      adr: 'ADR',
      sop: 'SOP',
      runbook: 'Runbook',
      checklist: 'Checklist',
      notice: 'Notice',
      pitfalls: 'Pitfalls',
      troubleshooting: 'Troubleshooting Guide',
      reference: 'Technical Reference',
      handoff: 'Handoff',
      postmortem: 'Postmortem',
      report: 'Work Report',
    };
    const isForgingPreset = id => typeof id === 'string' && (id.startsWith('session-forging-') || id.startsWith('火种 · '));
    const firstMessageField = (value, setValue) => field('首条消息',
      h('textarea', { value, rows: 3, maxLength: 131072, onChange: e => setValue(e.target.value),
        placeholder: '希望这个会话先做什么？' }));
    const titleField = (value, setValue) => field('会话名称',
      h('input', { value, maxLength: 120, onChange: e => setValue(e.target.value), placeholder: '选填' }),
      '需要被点名协作时，建议起一个好辨认的名字。留空时由 DSH 根据首条消息命名。');
    const roleHint = '选填。例如「守住旧客户端兼容性」。从首轮起生效，本次派工可另行指定。';
    function Workbench({ call, openSession, workspaceTarget, stage }) {
      const [catalog, setCatalog] = React.useState(null),
        [workspace, setWorkspace] = React.useState(() => workspaceTarget.selected);
      const [source, setSource] = React.useState(null),
        [sparkId, setSparkId] = React.useState(null),
        [edits, setEdits] = React.useState(() => new Map()),
        [page, setPage] = React.useState('forge');
      const original = source?.source.sparks.find(s => s.id === sparkId) ?? source?.source.sparks[0];
      const sourceEdits = source && !source.readOnly ? edits.get(source.source.id) : undefined;
      const draft = original && (sourceEdits?.get(original.id) ?? original);
      const [firstMessage, setFirstMessage] = React.useState('');
      const [copy, setCopy] = React.useState(null);
      const [manage, setManage] = React.useState(null);
      const [loadedWorkspace, setLoadedWorkspace] = React.useState(null);
      const inFlight = React.useRef(false);
      const [error, setError] = React.useState(''),
        [validation, setValidation] = React.useState(''),
        [checking, setChecking] = React.useState(false),
        [busy, setBusy] = React.useState(false);
      const [title, setTitle] = React.useState(''),
        [responsibility, setResponsibility] = React.useState('');
      const [preview, setPreview] = React.useState(null),
        [importText, setImportText] = React.useState(''),
        [status, setStatus] = React.useState('');
      const attempt = React.useRef(null),
        generation = React.useRef(0);
      React.useEffect(() => {
        const accept = () => {
          const id = workspaceTarget.take();
          if (!id) return;
          setWorkspace(id);
          setPage('forge');
          setCopy(null);
          setError('');
        };
        workspaceTarget.listeners.add(accept);
        accept();
        return () => workspaceTarget.listeners.delete(accept);
      }, [workspaceTarget]);
      const [modelDefaults, setModelDefaults] = React.useState(null);
      const load = React.useCallback(
        async (id) => {
          const serial = ++generation.current;
          const value = await call('catalog', { workspaceId: id || null });
          if (serial !== generation.current) return value;
          setCatalog(value);
          setSource(current => current?.liveExample ? value.sources.find(item => item.liveExample) : value.sources.find(item => item.source.id === current?.source.id) ?? value.sources[0]);
          setLoadedWorkspace(id);
          return value;
        },
        [call]
      );
      React.useEffect(() => {
        let active = true;
        load(workspace).catch((e) => {
          if (active) setError(e.message);
        });
        return () => {
          active = false;
        };
      }, [workspace, load]);
      React.useEffect(() => {
        if (!draft || !source) return;
        const control = new AbortController();
        setChecking(true);
        const timer = setTimeout(
          () =>
            call(
              'sourcePreview',
              { text: JSON.stringify({ ...source.source, sparks: [draft] }) },
              control.signal
            )
              .then(() => {
                if (!control.signal.aborted) setValidation('');
              })
              .catch((e) => {
                if (!control.signal.aborted) setValidation(e.message);
              })
              .finally(() => {
                if (!control.signal.aborted) setChecking(false);
              }),
          200
        );
        return () => {
          clearTimeout(timer);
          control.abort();
        };
      }, [draft, source, call]);
      React.useEffect(() => {
        if (!draft || !catalog) return;
        const control = new AbortController(),
          selection = draft.cog.provider
            ? {
                provider: draft.cog.provider,
                model: draft.cog.model,
                ...(draft.cog.reasoningEffort
                  ? { reasoningEffort: draft.cog.reasoningEffort }
                  : {}),
              }
            : catalog.models.default;
        setModelDefaults(null);
        if (selection)
          call('modelDefaults', { selection }, control.signal)
            .then((value) => {
              if (!control.signal.aborted) setModelDefaults(value);
            })
            .catch(() => {});
        return () => control.abort();
      }, [draft?.cog, catalog, call]);
      const act = async (operation) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        setStatus('');
        try {
          await operation();
        } catch (e) {
          setError(e.message);
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      };
      const select = (item, spark = item.source.sparks[0]) => {
        setSource(item);
        setSparkId(spark.id);
        setError('');
        setStatus('');
      };
      const patch = (key, value) => setEdits(previous => {
        if (source.readOnly) return previous;
        const changes = new Map(previous.get(source.source.id));
        changes.set(draft.id, { ...(changes.get(draft.id) ?? draft), [key]: value });
        return new Map(previous).set(source.source.id, changes);
      });
      const download = () =>
        act(async () => {
          const text = source.builtin
            ? JSON.stringify(source.source)
            : await call('sourceExport', {
                reference: { id: source.source.id, revision: source.revision },
              });
          const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })),
            link = document.createElement('a');
          link.href = url;
          link.download = source.source.id + '.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      if (!catalog || !draft || !source)
        return h(
          'div',
          { className: 'sf-workbench' },
          h('h1', null, '锻造台'),
          error ? h('p', { role: 'alert' }, error) : h('p', null, '正在读取 DSH 配置…')
        );
      const configSection = (title, ...children) => section(title,
        h('fieldset', { className: 'sf-config-fields', disabled: Boolean(source.readOnly) }, ...children));
      const mode = draft.runtime?.preset ?? 'standard',
        available = catalog.modes[mode],
        selectedModel = draft.cog;
      const route = catalog.models.groups.find((g) => g.id === selectedModel.provider);
      const model = route?.models.find((m) => m.id === selectedModel.model);
      const cog = (value) => patch('cog', value);
      const energy = draft.energon,
        energyPatch = (key, value) => patch('energon', { ...energy, [key]: value });
      const number = (
        label,
        value,
        update,
        { min = 0, defaultText = '本插件不额外设限', step = 1 } = {}
      ) =>
        field(
          label,
          h('input', {
            type: 'number',
            min,
            max: Number.MAX_SAFE_INTEGER,
            step,
            value: value ?? '',
            placeholder: defaultText,
            onChange: (e) => update(e.target.value === '' ? null : Number(e.target.value)),
            'aria-label': label,
          }),
          `${min}–${Number.MAX_SAFE_INTEGER}${step === 1 ? '，整数' : ''}；空值：${defaultText}`
        );
      const toggle = (label, checked, update) =>
        h(
          'label',
          { className: 'sf-check' },
          h('input', { type: 'checkbox', checked, onChange: (e) => update(e.target.checked) }),
          label
        );
      const capabilities = (kind) => {
        const items = available[kind],
          chosen = draft.components[kind];
        return h(
          'div',
          null,
          h('h3', null, kind === 'tools' ? '工具' : 'Skills'),
          kind === 'skills' && !available.skillsLoaded
            ? h('p', null, '选择工作区后读取 Skills。')
            : null,
          h(
            'div',
            { className: 'sf-capabilities' },
            [
              ...items,
              ...chosen
                .filter((id) => !items.some((item) => item.name === id))
                .map((name) => ({ name, description: '当前宿主未提供；取消选择后才能创建。' })),
            ].map((item) =>
              h(
                'label',
                { key: item.name, className: 'sf-check', title: item.description },
                h('input', {
                  type: 'checkbox',
                  checked: chosen.includes(item.name),
                  onChange: (e) =>
                    patch('components', {
                      ...draft.components,
                      [kind]: e.target.checked
                        ? [...chosen, item.name]
                        : chosen.filter((id) => id !== item.name),
                    }),
                }),
                h('span', null, item.name, h('small', null, item.description))
              )
            )
          )
        );
      };
      const problems = [
        !workspace && '请选择工作区。',
        workspace && loadedWorkspace !== workspace && '请等候该工作区的配置加载完成。',
        checking ? '正在校验火种配置…' : validation,
      ].filter(Boolean);
      const create = async (item, spark) => {
        const input = {
          workspaceId: workspace,
          source: { id: item.source.id, revision: item.revision },
          sourceText: JSON.stringify(item.source),
          sparkId: spark.id, spark, title: title.trim(), responsibility, firstMessage,
        };
        const fingerprint = JSON.stringify(input);
        if (attempt.current?.fingerprint !== fingerprint)
          attempt.current = { fingerprint, input: { ...input, requestId: crypto.randomUUID() } };
        if (!firstMessage.trim()) {
          await stage(workspace, null, spark.name, 'workbenchCreate', attempt.current.input, spark.cog);
          attempt.current = null;
          return;
        }
        const result = await call('workbenchCreate', { input: attempt.current.input });
        await openSession(result.sessionId);
        attempt.current = null;
      };
      const marked = catalog.quantity.some(row => row.source.id === source.source.id && row.sparkId === draft.id);
      const editable = !source.readOnly && (!source.builtin || draft.id.startsWith('copy-'));
      const dirty = JSON.stringify(draft) !== JSON.stringify(original);
      const mark = () => act(async () => {
        const quantity = await call('quantitySet', { text: JSON.stringify(source.source), sparkId: draft.id, enabled: !marked });
        setCatalog(current => ({ ...current, quantity }));
        setStatus(marked ? '已移出量产，火种仍保存在来源中。' : '已加入量产，可从新会话的「火种」菜单创建。');
      });
      const changeSaved = () => act(async () => {
        const removing = manage.kind === 'delete';
        const result = await call('changeSpark', { source: { id: source.source.id, revision: source.revision },
          sparkId: original.id, spark: removing ? null : { ...draft, name: manage.name.trim() } });
        const item = { ...source, ...result };
        setEdits(previous => {
          const next = new Map(previous), entries = new Map(next.get(item.source.id));
          entries.delete(original.id); next.set(item.source.id, entries); return next;
        });
        setCatalog(current => ({ ...current, sources:current.sources.map(row => row.source.id === item.source.id ? item : row),
          quantity: removing ? current.quantity.filter(row => row.source.id !== item.source.id || row.sparkId !== original.id) : current.quantity }));
        select(item, item.source.sparks.find(spark => spark.id === original.id));
        setManage(null);
        setStatus(removing ? '火种已删除，已有会话保留创建时的配置。' : '火种已保存。');
      });
      const beginCopy = kind => {
        setError('');
        const baseName = kind === 'spark' ? draft.name : source.liveExample ? '原生示例' : source.displayName ?? source.source.name;
        setCopy({ kind, id: 'copy-' + crypto.randomUUID(),
          name: baseName.slice(0, 117) + ' 副本' });
      };
      const saveCopy = forge => act(async () => {
        let item, selected;
        if (copy.kind === 'spark') {
          selected = { ...draft, id: copy.id, name: copy.name.trim() };
          item = { ...await call('saveSparkCopy', {
            sourceText: JSON.stringify(source.source), spark: selected,
          }), builtin: source.builtin };
        } else {
          const manifest = { ...source.source, id: copy.id, name: copy.name.trim(),
            sparks: source.source.sparks.map(spark => sourceEdits?.get(spark.id) ?? spark) };
          item = { ...await call('saveSourceCopy', { text: JSON.stringify(manifest) }), builtin: false };
          selected = item.source.sparks.find(spark => spark.id === draft.id);
        }
        setCatalog(current => {
          const sources = current.sources.some(entry => entry.source.id === item.source.id)
            ? current.sources.map(entry => entry.source.id === item.source.id ? item : entry)
            : [...current.sources.filter(entry => !entry.liveExample), item, ...current.sources.filter(entry => entry.liveExample)];
          return { ...current, sources };
        });
        select(item, selected);
        setCopy(null);
        setStatus(copy.kind === 'spark' ? '新火种已保存' : '火种源副本已保存');
        if (forge) {
          try { await create(item, selected); }
          catch (cause) {
            throw Error('火种源副本已保存。可直接点击「发送并创建会话」重试。' + cause.message);
          }
        }
      });
      const copyDialog = copy && h(Modal, {
        open: true, title: copy.kind === 'spark' ? '另存为新火种' : '另存为新火种源',
        closeLabel: '取消', onClose: () => { if (!busy) setCopy(null); },
      }, field('副本名称', h('input', { value: copy.name, maxLength: 120, disabled: busy,
        onChange: event => setCopy({ ...copy, name: event.target.value }) })),
      error && h('p', { role: 'alert', className: 'sf-error' }, error),
      h('div', { className: 'sf-actions' },
        h(Button, { type: 'button', disabled: busy || !copy.name.trim(), onClick: () => saveCopy(false) }, '保存副本'),
        copy.kind === 'source' && h(Button, { type: 'button',
          disabled: busy || !copy.name.trim() || problems.length > 0, onClick: () => saveCopy(true) }, '保存并锻造')),
      copy.kind === 'source' && problems.length > 0 && h('p', null, '锻造会话：' + problems.join(' ')));
      return h(
        'div',
        { className: 'sf-workbench' },
        h('h1', null, '锻造台'),
        h(
          'nav',
          { className: 'sf-tabs' },
          h(
            Button,
            {
              onClick: () => setPage('forge'),
              variant: page === 'forge' ? 'primary' : 'secondary',
            },
            '锻造会话'
          ),
          h(
            Button,
            {
              onClick: () => setPage('sources'),
              variant: page === 'sources' ? 'primary' : 'secondary',
            },
            '火种源'
          )
        ),
        copyDialog,
        manage && h(Modal, {open:true, title:manage.kind === 'delete' ? '删除火种' : '保存火种修改',
          closeLabel:'取消', onClose:()=>{ if (!busy) setManage(null); }},
          manage.kind === 'delete' ? h('p',null,'从来源和量产菜单中移除「' + original.name + '」？已有会话可继续使用。')
            : field('火种名称',h('input',{value:manage.name,maxLength:120,onChange:e=>setManage({...manage,name:e.target.value})})),
          error && h('p',{role:'alert'},error),
          h(Button,{type:'button',disabled:busy || !manage.name.trim(),onClick:changeSaved},manage.kind === 'delete' ? '确认删除' : '保存修改')),
        page === 'sources' && error ? h('p', { role: 'alert', className: 'sf-error' }, error) : null,
        status ? h('p', { role: 'status' }, status) : null,
        page === 'sources'
          ? h(
              'div',
              null,
              section(
                '火种源',
                choices(
                  source.source.id,
                  (id) => select(catalog.sources.find((item) => item.source.id === id)),
                  catalog.sources.map((item) => [item.source.id, item.displayName ?? item.source.name]),
                  '火种源'
                ),
                h('p', null, source.source.description),
                h(
                  'div',
                  { className: 'sf-actions' },
                  field(
                    '导入 JSON',
                    h('input', {
                      type: 'file',
                      accept: '.json,application/json',
                      disabled: busy,
                      onChange: (e) => {
                        const file = e.target.files[0];
                        if (file)
                          act(async () => {
                            if (file.size > 262144) throw Error('主文件不得超过 256 KiB');
                            const text = await file.text();
                            const value = await call('sourcePreview', { text });
                            setImportText(text);
                            setPreview(value);
                          });
                        e.target.value = '';
                      },
                    })
                  ),
                  h(Button, { disabled: busy, onClick: download }, '导出')
                )
              ),
              preview
                ? section(
                    '导入预览',
                    h('h3', null, preview.source.name),
                    h('p', null, preview.source.description),
                    h(
                      'p',
                      null,
                      `${preview.source.sparks.length} 枚火种 · ${preview.revision.slice(0, 12)}`
                    ),
                    ...preview.source.sparks.map((spark) =>
                      h(
                        'details',
                        { key: spark.id },
                        h('summary', null, spark.name),
                        h('p', null, spark.description),
                        h(
                          'pre',
                          null,
                          JSON.stringify(
                            {
                              ...spark,
                              provenance: spark.provenance
                                ? {
                                    project: spark.provenance.project,
                                    license: spark.provenance.license,
                                    url: spark.provenance.url,
                                  }
                                : undefined,
                            },
                            null,
                            2
                          )
                        )
                      )
                    ),
                    h(
                      'div',
                      { className: 'sf-actions' },
                      h(
                        Button,
                        {
                          disabled: busy,
                          onClick: () =>
                            act(async () => {
                              await call('sourceImport', {
                                text: importText,
                                revision: preview.revision,
                              });
                              const updated = await load(workspace);
                              select(
                                updated.sources.find((item) => item.revision === preview.revision)
                              );
                              setPreview(null);
                              setStatus('火种源已创建');
                            }),
                        },
                        '确认创建火种源'
                      ),
                      h(
                        Button,
                        {
                          onClick: () => {
                            setPreview(null);
                            setImportText('');
                          },
                        },
                        '取消'
                      )
                    )
                  )
                : null
            )
          : h(
              'div', null,
              section(
                '工作区',
                choices(
                  workspace,
                  (id) => {
                    workspaceTarget.selected = id;
                    setWorkspace(id);
                    attempt.current = null;
                  },
                  [
                    ['', '选择原生工作区'],
                    ...catalog.workspaces.map((w) => [w.id, w.name || w.path]),
                  ],
                  '工作区'
                ),
                h('div', { className: 'sf-row' },
                  titleField(title, setTitle),
                  field(
                    '本会话使命',
                    h('input', {
                      value: responsibility,
                      onChange: (e) => setResponsibility(e.target.value),
                      required: false,
                      maxLength: 300,
                    }),
                    roleHint
                  ),
                )
              ),
              firstMessageField(firstMessage, setFirstMessage),
              h('small', {className:'sf-muted'},'也可以先进入对话。发送前切走，本次锻造自动取消。'),
              section(
                '01 / 火种源',
                choices(
                  source.source.id,
                  (id) => select(catalog.sources.find((item) => item.source.id === id)),
                  catalog.sources.map((item) => [item.source.id, item.displayName ?? item.source.name]),
                  '火种源'
                ),
                h('p', null, source.source.description)
              ),
              section(
                '02 / 选择火种',
                h(
                  'div',
                  { className: 'sf-sparks' },
                  source.source.sparks.map((spark) =>
                    h(
                      'button',
                      {
                        key: spark.id,
                        type: 'button',
                        'aria-pressed': draft.id === spark.id,
                        onClick: () => select(source, spark),
                      },
                      h('strong', null, spark.name),
                      h('small', null, spark.description)
                    )
                  )
                ),
                draft.provenance
                  ? h(
                      'p',
                      { className: 'sf-muted' },
                      draft.provenance.project,
                      ' · ',
                      h(
                        'a',
                        { href: draft.provenance.url, target: '_blank', rel: 'noreferrer' },
                        draft.provenance.revision.slice(0, 12)
                      ),
                      ' · ',
                      draft.provenance.license
                    )
                  : h('p', { className: 'sf-muted' }, '配置来自当前 DSH 原生 Preset')
              ),
              configSection(
                '03 / 火种配置',
                source.readOnly ? null : h(Button, { type: 'button', disabled: busy || checking || Boolean(validation),
                  onClick: () => beginCopy('spark') }, '另存为新火种'),
                !source.readOnly && h('div',{className:'sf-actions'},
                  editable && h(Button,{type:'button',disabled:busy || checking || Boolean(validation),
                    onClick:()=>setManage({kind:'edit',name:draft.name})},'编辑并保存火种'),
                  h(Button,{type:'button',disabled:busy || (!marked && dirty),onClick:mark,
                    title:dirty && !marked ? '请先保存修改或另存为新火种' : undefined},marked ? '移出量产' : '加入量产'),
                  editable && h(Button,{type:'button',disabled:busy || source.source.sparks.length < 2,
                    onClick:()=>setManage({kind:'delete',name:draft.name})},'删除火种')),
                h('h3', null, '指令 · Persona'),
                field(
                  'Persona',
                  h('textarea', {
                    value: draft.persona,
                    onChange: (e) => patch('persona', e.target.value),
                    rows: 6,
                    maxLength: 16000,
                  })
                ),
                h(
                  'details',
                  null,
                  h('summary', null, '变量预览'),
                  h(
                    'pre',
                    null,
                    draft.persona.replace(
                      /\{\{\s*(provider|model)\s*\}\}/g,
                      (_m, key) => draft.cog[key] || catalog.models.default?.[key] || ''
                    )
                  )
                ),
                h('h3', null, '档案 · soul'),
                field(
                  'soul.md',
                  h('textarea', {
                    value: draft.soul,
                    onChange: (e) => patch('soul', e.target.value),
                    rows: 4,
                    maxLength: 16000,
                  })
                ),
                h('h3', null, '齿轮 · Cog'),
                h(
                  'div',
                  { className: 'sf-row' },
                  field(
                    '提供方',
                    choices(
                      selectedModel.provider,
                      (provider) =>
                        cog({
                          provider,
                          model:
                            catalog.models.groups.find((g) => g.id === provider)?.models[0]?.id ??
                            '',
                          reasoningEffort: '',
                        }),
                      [
                        ['', '沿用 DSH 当前选择'],
                        ...catalog.models.groups.map((g) => [g.id, g.name ?? g.id]),
                      ],
                      '提供方'
                    )
                  ),
                  field(
                    '模型',
                    choices(
                      selectedModel.model,
                      (value) => cog({ ...selectedModel, model: value, reasoningEffort: '' }),
                      route ? route.models.map((m) => [m.id, m.name]) : [['', '沿用 DSH 当前选择']],
                      '模型'
                    ),
                    !selectedModel.provider && !selectedModel.reasoningEffort
                      ? '在新会话里选中此火种时，会沿用输入框右下角当前的模型和推理等级。'
                      : null
                  ),
                  model?.reasoning?.efforts?.length
                    ? field(
                        '推理强度',
                        choices(
                          selectedModel.reasoningEffort,
                          (value) => cog({ ...selectedModel, reasoningEffort: value }),
                          [
                            ['', '自动'],
                            ...model.reasoning.efforts.map((e) => [e.id, e.name ?? e.id]),
                          ],
                          '推理强度'
                        )
                      )
                    : null
                )
              ),
              configSection(
                '04 / 工具与 Skills',
                h(
                  'p',
                  { className: 'sf-muted' },
                  `当前基底：${mode}。下方为该模式的实际可用清单；选择不授予额外权限。`
                ),
                h(
                  'details',
                  null,
                  h('summary', null, '查看 standard 标准模式参照'),
                  h(
                    'div',
                    { className: 'sf-capabilities' },
                    ...catalog.modes.standard.tools.map((t) =>
                      h(
                        'p',
                        { key: t.name },
                        h('strong', null, t.name),
                        h('small', null, t.description)
                      )
                    )
                  ),
                  h(
                    'p',
                    null,
                    'Skills：' +
                      (catalog.modes.standard.skillsLoaded
                        ? catalog.modes.standard.skills.map((s) => s.name).join('、')
                        : '选择工作区后读取')
                  )
                ),
                capabilities('tools'),
                capabilities('skills')
              ),
              configSection(
                '05 / 能量 · Energon',
                h(
                  'div',
                  { className: 'sf-row' },
                  number(
                    '每次输出 Token 上限',
                    energy.maxTokens,
                    (value) => energyPatch('maxTokens', value),
                    {
                      min: 1,
                      defaultText: `继承适配器${modelDefaults?.maxTokens ? '（当前默认 ' + modelDefaults.maxTokens + '）' : ''}`,
                    }
                  ),
                  number('累计 Token 额度', energy.tokenLimit, (value) =>
                    energyPatch('tokenLimit', value)
                  ),
                  number(
                    '单 Turn 耗时（毫秒）',
                    energy.maxTurnDurationMs,
                    (value) => energyPatch('maxTurnDurationMs', value),
                    { min: 1 }
                  ),
                  number('提前收尾时间（毫秒）', energy.wrapUpLeadTimeMs, (value) =>
                    energyPatch('wrapUpLeadTimeMs', value ?? 0)
                  ),
                  field(
                    '绝对截止时间',
                    h('input', {
                      type: 'datetime-local',
                      value: energy.deadlineAt
                        ? new Date(
                            energy.deadlineAt -
                              new Date(energy.deadlineAt).getTimezoneOffset() * 60000
                          )
                            .toISOString()
                            .slice(0, 16)
                        : '',
                      onChange: (e) =>
                        energyPatch(
                          'deadlineAt',
                          e.target.value ? new Date(e.target.value).getTime() : null
                        ),
                    })
                  )
                ),
                h('h3', null, 'Step'),
                h(
                  'p',
                  { className: 'sf-muted' },
                  '预留包含在总步数内；最终答复 ≤ 收尾 ≤ 总步数。同一 Turn 的 steer 不重置。'
                ),
                h(
                  'div',
                  { className: 'sf-row' },
                  ...[
                    ['maxStepsPerTurn', '总 Step 上限', 1],
                    ['wrapUpSteps', '收尾预留 Step', 0],
                    ['finalReplySteps', '最终答复预留 Step', 0],
                  ].map(([key, label, min]) =>
                    h(
                      React.Fragment,
                      { key },
                      number(
                        label,
                        energy.steps[key],
                        (value) =>
                          energyPatch('steps', {
                            ...energy.steps,
                            [key]: value ?? (min ? null : 0),
                          }),
                        { min }
                      )
                    )
                  )
                ),
                h('h3', null, 'Web · 单次工具调用'),
                h(
                  'div',
                  { className: 'sf-row' },
                  ...Object.entries({
                    searchMaxQueries: '查询数',
                    searchMaxResults: '结果数',
                    searchSummaryMaxChars: '摘要字符数',
                    searchTimeoutMs: '查询超时（毫秒）',
                    fetchTimeoutMs: '抓取超时（毫秒）',
                  }).map(([key, label]) =>
                    h(
                      React.Fragment,
                      { key },
                      number(
                        label,
                        energy.web[key],
                        (value) => energyPatch('web', { ...energy.web, [key]: value }),
                        { min: 1, defaultText: '继承宿主 ' + available.webDefaults[key] }
                      )
                    )
                  )
                ),
                h('h3', null, '费用'),
                number(
                  '累计费用额度',
                  energy.costLimit,
                  (value) => energyPatch('costLimit', value),
                  { step: 'any' }
                ),
                energy.costLimit != null
                  ? h(
                      'div',
                      null,
                      field(
                        '计价币种',
                        h('input', {
                          value: energy.costCurrency ?? '',
                          placeholder: 'USD',
                          maxLength: 3,
                          onChange: (e) =>
                            energyPatch('costCurrency', e.target.value.toUpperCase()),
                        })
                      ),
                      h(
                        'p',
                        { className: 'sf-muted' },
                        '自行提供每百万 Token 单价；无单价或缺用量时拒绝后续调用。额度可能被一次在途请求超出。'
                      ),
                      ...['input', 'output', 'cacheRead', 'cacheWrite'].map((key) => {
                        const provider = selectedModel.provider || catalog.models.default?.provider,
                          model = selectedModel.model || catalog.models.default?.model;
                        const price = energy.pricing?.find(
                          (p) => p.provider === provider && p.model === model
                        );
                        return h(
                          React.Fragment,
                          { key },
                          number(
                            {
                              input: '输入',
                              output: '输出',
                              cacheRead: '缓存读取',
                              cacheWrite: '缓存写入',
                            }[key] + '单价',
                            price?.[key],
                            (value) => {
                              const next = { provider, model, ...price };
                              if (value === null) delete next[key];
                              else next[key] = value;
                              energyPatch('pricing', [
                                ...(energy.pricing ?? []).filter(
                                  (p) => p.provider !== provider || p.model !== model
                                ),
                                next,
                              ]);
                            },
                            { step: 'any', defaultText: '需显式设置' }
                          )
                        );
                      })
                    )
                  : null
              ),
              configSection(
                '06 / 协作',
                toggle('领袖模块', draft.matrix, (value) => patch('matrix', value)),
                toggle('议事厅', draft.council?.enabled ?? false, (value) =>
                  patch('council', { enabled: value, types: draft.council?.types ?? [] })
                ),
                draft.council?.enabled
                  ? h(
                      'div',
                      { className: 'sf-capabilities' },
                      ...Object.entries(councilTypes).map(([key, label]) =>
                        h(
                          React.Fragment,
                          { key },
                          toggle(label, draft.council.types.includes(key), (value) =>
                            patch('council', {
                              ...draft.council,
                              types: value
                                ? [...draft.council.types, key]
                                : draft.council.types.filter((t) => t !== key),
                            })
                          )
                        )
                      )
                    )
                  : null
              ),
              problems.length ? h('p', { role: 'status' }, problems.join(' ')) : null,
              error && !copy ? h('p', { role: 'alert', className: 'sf-error' }, error) : null,
              h(
                'div',
                { className: 'sf-actions' },
                h(
                  Button,
                  {
                    type: 'button', onClick: () => act(() => create(source, draft)),
                    disabled: busy || problems.length > 0,
                  },
                  firstMessage.trim() ? '发送并创建会话' : '进入对话'
                ),
                h(Button, { type: 'button', disabled: busy, onClick: () => beginCopy('source') }, '另存为新火种源…')
              )
            )
      );
    }
    function RallyPanel({ sessionId, call, data, watchRoster, useWorkspaces, onDelivered }) {
      const [scope, setScope] = React.useState('workspace');
      const [group, setGroup] = React.useState(data.group);
      const [granted, setGranted] = React.useState(data.granted);
      const [all, setAll] = React.useState(true), [ids, setIds] = React.useState([]);
      const [removal, setRemoval] = React.useState(null);
      const [message, setMessage] = React.useState(''), [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false), [revision, refresh] = React.useReducer(n => n + 1, 0);
      const workspaces = useWorkspaces(state => state.items);
      const attempt = React.useRef(null);
      React.useEffect(() => {
        let alive = true, pending = false, dirty = false, timer;
        async function load() {
          timer = undefined;
          if (pending) { dirty = true; return; }
          pending = true;
          try {
            const next = await call('rallyMembers', { id: sessionId, scope });
            if (alive) setGroup(next);
          } catch (cause) { if (alive) { setError(cause.message); setGroup(null); } }
          finally {
            pending = false;
            if (dirty && alive) { dirty = false; schedule(); }
          }
        }
        function schedule() { if (!timer) timer = setTimeout(load, 120); }
        const stop = watchRoster(schedule);
        load();
        return () => { alive = false; clearTimeout(timer); stop(); };
      }, [scope, revision, sessionId, call, watchRoster]);
      const run = async operation => {
        setBusy(true); setError('');
        try { await operation(); refresh(); }
        catch (cause) { setError(cause.message); }
        finally { setBusy(false); }
      };
      const changeScope = value => {
        setScope(value); setGroup(null); setIds([]); attempt.current = null;
      };
      const row = member => {
        const label = member.name + ' · ' + member.sessionId.slice(-8);
        return h('li', { key: member.sessionId },
          data.leader && !all && !member.archived && member.sessionId !== sessionId &&
            h('input', { type: 'checkbox', 'aria-label': '选择 ' + label, checked: ids.includes(member.sessionId),
              onChange: e => { attempt.current = null; setIds(e.target.checked ? [...ids, member.sessionId] : ids.filter(id => id !== member.sessionId)); } }),
          label, member.sessionId === sessionId && '（本会话）',
          scope === 'authorized' && ' · ' + member.workspaceName,
          member.responsibility && ' · ' + member.responsibility,
          member.archived && data.leader && h(Button, { disabled: busy, onClick: () => run(async () => {
            await call('rallyRevive', {input:{ sessionId, targetId:member.sessionId, scope, requestId:crypto.randomUUID() }});
          }) }, '恢复会话'),
          member.archived && data.leader && member.sessionId !== sessionId && h(Button, {
            disabled: busy, onClick: () => { setError(''); setRemoval(member); }
          }, '从锻造台永久移除'));
      };
      const members = group?.members ?? [], active = members.filter(m => !m.archived), archived = members.filter(m => m.archived);
      const canRemove = removal && archived.some(m => m.sessionId === removal.sessionId && m.workspaceId === removal.workspaceId);
      const send = () => run(async () => {
        attempt.current ??= { sessionId, scope, requestId:crypto.randomUUID(), membershipRevision: group.revision,
          message: message.trim(), ...(!all && { targets:ids }) };
        if (attempt.current.membershipRevision !== group.revision) {
          attempt.current = null;
          throw Error('成员已变化，请核对名单后重新发送。');
        }
        await call('rally', { input:attempt.current });
        attempt.current = null; setMessage(''); await onDelivered();
      });
      return section('召集令',
        error && !removal && h('p', {role:'alert'}, error),
        removal && h(Modal, { open:true, title:'从锻造台永久移除', closeLabel:'关闭', onClose:() => { if (!busy) setRemoval(null); } },
          h('p', null, '移除「' + removal.name + ' · ' + removal.sessionId.slice(-8) + '」后，所有召集令名单都会隐藏它，领袖也无法再召集或恢复它。DSH 会保留原会话和历史记录。'),
          !canRemove && h('p', {role:'status'}, '成员状态已变化，请重新查看名单。'),
          error && h('p', {role:'alert'}, error),
          h(Button, { disabled:busy, onClick:() => setRemoval(null) }, '取消'),
          h(Button, { disabled:busy || !canRemove, onClick:() => run(async () => {
            await call('rallyRemove', {input:{sessionId, targetId:removal.sessionId, workspaceId:removal.workspaceId, scope}});
            setRemoval(null);
            attempt.current = null;
          }) }, '确认永久移除')),
        data.leader && h('details', null, h('summary', null, '跨工作区授权'),
          ...workspaces.filter(w => w.workspaceId !== data.group?.workspaceId).map(w =>
            h('label', {key:w.workspaceId}, h('input', { type:'checkbox', disabled:busy, checked:granted.includes(w.workspaceId),
              onChange:e => { const enabled = e.target.checked; run(async () => {
                setGranted(await call('rallyGrant', {input:{sessionId, workspaceId:w.workspaceId, enabled}}));
                attempt.current = null;
              }); } }), w.title || w.path || w.workspaceId)) ),
        data.leader && granted.length > 0 && field('召集范围', choices(scope, changeScope,
          [['workspace','本工作区'],['authorized','本工作区及已授权工作区']], '召集范围')),
        h('p',null,group ? '未归档成员 · ' + active.length : '正在读取成员…'),
        h('ul',null,...active.map(row)),
        archived.length > 0 && h('details', null, h('summary',null,'已归档 · ' + archived.length), h('ul',null,...archived.map(row))),
        data.leader && h(React.Fragment,null,
          field('接收成员',choices(all ? 'all' : 'selected', value => {setAll(value === 'all'); attempt.current = null;},
            [['all','所有其他未归档成员'],['selected','点名选择']], '接收成员')),
          field('项目变化',h('textarea',{ value:message, maxLength:8000, rows:3,
            onChange:e=>{setMessage(e.target.value); attempt.current = null;} })),
          h(Button,{disabled:busy || !message.trim() || !group || (all ? !active.some(m=>m.sessionId !== sessionId) : !ids.length),
            onClick:send},'发起召集')));
    }

    function Collaboration({ sessionId, call, watchRoster, useWorkspaces }) {
      const [data, setData] = React.useState(null),
        [error, setError] = React.useState(''),
        [busy, setBusy] = React.useState(false);
      const [doc, setDoc] = React.useState(null),
        [docName, setDocName] = React.useState(''),
        [docText, setDocText] = React.useState(''),
        [deletePending, setDeletePending] = React.useState(false);
      const load = React.useCallback(async () => {
        setData(await call('collaboration', { id: sessionId }));
      }, [sessionId, call]);
      React.useEffect(() => {
        setData(null);
        setDoc(null);
        setError('');
        load().catch((e) => setError(e.message));
      }, [load]);
      const act = async (operation) => {
        setBusy(true);
        setError('');
        try {
          await operation();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      };
      if (!data)
        return h(
          'section',
          null,
          h('p', { role: error ? 'alert' : undefined }, error || '读取工作区…')
        );
      const read = (name) =>
        act(async () => {
          const value = await call('councilDocument', { input: { sessionId, name } });
          setDoc(value);
          setDocName(value.name);
          setDocText(value.text);
          setDeletePending(false);
        });
      const rally = (input) =>
        act(async () => {
          await call('rally', { input });
            await load();
        });
      return h(
        'div',
        { className: 'sf-collaboration' },
        error ? h('p', { role: 'alert', className: 'sf-error' }, error) : null,
        !data.rallyRemoved && section('Matrix 领袖资格',
          h('p', null, data.leader ? '此领袖可向本工作区及已授权工作区的锻造成员发出召集令。' : '此会话是普通锻造成员。'),
          h('p', { className: 'session-forging-note' },
            'dsh-context 中的原生 lead 描述 DSH 的 Agent 身份。Matrix 资格由锻造插件校验。',
            data.leader ? '在工具定义中查看 forging_rally。' : '',
            '召集令送达后，在接收成员后续请求的注入内容中查看 session-forging:rally。')),
        data.council && section(
          '议事厅',
          h('p', { className: 'session-forging-note' }, data.council.guidance
            ? '在 dsh-context 的' + (data.council.guidance === 'system-prompt' ? '系统提示词' : '注入内容 → runtime-context → 原文') +
              '中查找 Project council documents，核对本会话的写作指引。'
            : '本会话未启用议事厅写作指引。'),
          h('code', { className: 'session-forging-path' }, data.council.path ?? '未归属工作区'),
          h(
            'div',
            { className: 'sf-actions' },
            h(Button, { disabled: busy, onClick: () => act(load) }, '刷新'),
            h(
              Button,
              {
                disabled: busy || !data.council.path,
                onClick: () => {
                  setDoc({ revision: null });
                  setDocName('');
                  setDocText('');
                  setDeletePending(false);
                },
              },
              '新建文档'
            )
          ),
          h(
            'ul',
            null,
            ...data.council.files.map((name) =>
              h(
                'li',
                { key: name },
                h('button', { type: 'button', onClick: () => read(name) }, name)
              )
            )
          ),
          doc
            ? h(
                'div',
                null,
                field(
                  '文档路径',
                  h('input', {
                    value: docName,
                    disabled: Boolean(doc.name),
                    onChange: (e) => setDocName(e.target.value),
                    placeholder: '01-design/plan.md',
                    maxLength: 240,
                  })
                ),
                field(
                  '文档正文',
                  h('textarea', {
                    value: docText,
                    onChange: (e) => setDocText(e.target.value),
                    rows: 8,
                  })
                ),
                h(
                  'div',
                  { className: 'sf-actions' },
                  h(
                    Button,
                    {
                      disabled: busy || !docName,
                      onClick: () =>
                        act(async () => {
                          const value = await call('councilDocument', {
                            input: {
                              sessionId,
                              name: docName,
                              action: 'write',
                              text: docText,
                              revision: doc.revision,
                            },
                          });
                          setDoc(value);
                          await load();
                        }),
                    },
                    '保存文档'
                  ),
                  doc.name
                    ? h(
                        Button,
                        {
                          disabled: busy,
                          onClick: () => {
                            if (!deletePending) {
                              setDeletePending(true);
                              return;
                            }
                            act(async () => {
                              await call('councilDocument', {
                                input: {
                                  sessionId,
                                  name: doc.name,
                                  action: 'delete',
                                  revision: doc.revision,
                                },
                              });
                              setDoc(null);
                              await load();
                            });
                          },
                        },
                        deletePending ? '确认删除' : '删除文档'
                      )
                    : null,
                  h(Button, { onClick: () => setDoc(null) }, '关闭文档')
                )
              )
            : null
        ),
        !data.rallyRemoved && h(RallyPanel, { sessionId, call, data, watchRoster, useWorkspaces, onDelivered:load }),
        section(
          '召集记录',
          data.records.length
            ? h(
                'ul',
                null,
                ...data.records.map((record) =>
                  h(
                    'li',
                    { key: record.id },
                    h('p', null, record.message),
                    h('small', null, new Date(record.createdAt).toLocaleString()),
                    ...record.targets.map((target) =>
                      h(
                        'p',
                        { key: target.sessionId },
                        target.sessionId.slice(-8),
                        ' · ',
                        {
                          accepted: '输入已接收',
                          pending: '待投递',
                          sending: '投递中',
                          failed: '失败',
                          uncertain: '结果不确定',
                        }[target.status],
                        target.error ? ' · ' + target.error : ''
                      )
                    ),
                    data.leader &&
                      record.sender === sessionId &&
                      record.input &&
                      record.targets.some((t) => ['failed', 'pending'].includes(t.status))
                      ? h(
                          Button,
                          { disabled: busy, onClick: () => rally(record.input) },
                          '重试未投递成员'
                        )
                      : null
                  )
                )
              )
            : h('p', null, '暂无召集记录')
        ),
        section(
          '能量用量',
          h(
            'p',
            null,
            `${data.energon.usage.tokens} Token · ${data.energon.usage.calls} 次调用${data.energon.usage.unknownUsage ? ' · ' + data.energon.usage.unknownUsage + ' 次用量缺失' : ''}`
          ),
          data.energon.config.costLimit != null
            ? h(
                'p',
                null,
                data.energon.usage.unknownCost
                  ? '费用不可完整计量'
                  : `${data.energon.usage.cost} ${data.energon.config.costCurrency}`
              )
            : null
        )
      );
    }

    function useConnectionRevision(subscribeReset) {
      const [revision, refresh] = React.useReducer((value) => value + 1, 0);
      React.useEffect(() => subscribeReset(refresh), [subscribeReset]);
      return [revision, refresh];
    }

    function ForgingNotice({ sessionId, readNotice, subscribeReset, useProjection }) {
      const preset = useProjection('agentPreset');
      const [notice, setNotice] = React.useState(null);
      const [revision] = useConnectionRevision(subscribeReset);
      React.useEffect(() => {
        if (!sessionId.startsWith('forged-') || !isForgingPreset(preset)) return;
        const control = new AbortController();
        (async () => {
          let cursor = null;
          while (!control.signal.aborted) {
            const value = await readNotice(sessionId, cursor, control.signal);
            if (!value || control.signal.aborted) return;
            if (value.message) setNotice(value);
            cursor = value.revision;
          }
        })().catch(() => {
          /* A connection reset restarts the notice subscription. */
        });
        return () => control.abort();
      }, [sessionId, preset, revision, readNotice]);
      return notice ? h(Toast, {
        key: notice.revision, text: notice.message, holdMs: 6000, onDone: () => setNotice(null),
      }) : null;
    }

    // Use the host's complete blank conversation and its editor. This occurrence
    // has no transcript yet and therefore needs no persisted conversation view.
    const transientViews = { views: () => null };
    function ForgetOrdinaryDraft({sessionId, target, actions}) {
      React.useEffect(() => {
        if (sessionId === target) actions.setDraft('');
      }, [sessionId, target, actions]);
      return null;
    }
    function NativeForgePage({renderFactorySlot, initialize}) {
      React.useEffect(initialize, [initialize]);
      return h('div', {className:'sf-native-conversation'},
        renderFactorySlot('conversation.content', {variant:'main', phase:'hero', hero:true}, {slots:transientViews}));
    }

    function ForgeWorkspacePicker({renderFactorySlot, open, anchorRef, selectedId, onClose, onPick, leaveWorkspace}) {
      return renderFactorySlot('workspace.picker', {open, anchorRef, selectedId, onClose, onPick: id => {
        if (id !== selectedId) leaveWorkspace();
        onPick(id);
      }});
    }

    async function applySparkModel(directory, cog, isCurrent) {
      if (!directory || !cog || (!cog.model && !cog.reasoningEffort) || Boolean(cog.model) !== Boolean(cog.provider)) return;
      const before = directory.store.getSnapshot();
      if (before.pending || !isCurrent()) return;
      const state = await directory.load();
      const current = state.current;
      if (!isCurrent() || state.pending) return;
      // A manual selection while the catalog loaded takes precedence.
      if (before.current && (before.current.provider !== current?.provider || before.current.model !== current?.model ||
          before.current.reasoningEffort !== current?.reasoningEffort)) return;
      const provider = cog.provider || current?.provider;
      const model = cog.model || current?.model;
      const route = state.groups.find(group => group.id === provider)?.models.find(item => item.id === model);
      if (!route || (cog.reasoningEffort && !route.reasoning?.efforts.some(item => item.id === cog.reasoningEffort))) return;
      if (current?.provider === provider && current.model === model &&
          (!cog.reasoningEffort || (current.reasoningEffort ?? route.reasoning?.defaultEffort) === cog.reasoningEffort)) return;
      await directory.select({provider, model, ...(cog.reasoningEffort ? {reasoningEffort:cog.reasoningEffort} : {})});
    }

    function QuantityMenu({ sessionId, workspaceId, access, call, stage, cancel, useSelection }) {
      const chosen = useSelection(s => s?.sessionId === sessionId ? s.name : '');
      const allowed = React.useSyncExternalStore(access.subscribe, access.getSnapshot);
      const [items, setItems] = React.useState([]), [open, setOpen] = React.useState(false);
      const [selected, setSelected] = React.useState(null), [role, setRole] = React.useState('');
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
      const [title, setTitle] = React.useState('');
      const lock = React.useRef(false);
      const run = async work => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try { await work(); } catch (cause) { setError(cause.message); }
        finally { lock.current = false; setBusy(false); }
      };
      const launch = (item, responsibility = '', title = '') => run(async () => {
        setSelected(null);
        await stage(workspaceId, sessionId, item.name, 'quantityCreate', {
          origin:sessionId, source:item.source, sparkId:item.sparkId, version:item.version,
          requestId:crypto.randomUUID(), responsibility, title,
        }, item.cog);
      });
      const pick = key => {
        if (key === 'cancel-forging') { setOpen(false); cancel(); return; }
        const item = items.find(row => row.key === key);
        if (!item) return;
        setOpen(false); setRole(''); setTitle(''); setError('');
        if (item.matrix) setSelected(item);
        else void launch(item);
      };
      if (!allowed) return null;
      return h(React.Fragment, null,
        h(Menu,{open,onClose:()=>setOpen(false),align:'start',portal:true,onSelect:pick,
          items:[...(chosen ? [{id:'cancel-forging',label:'取消本次锻造'}] : []), ...(items.length ? items.map(item=>({id:item.key,label:h('span',null,h('span',null,item.name),
            h('small',{className:'sf-menu-source'},item.sourceName))}))
            : [{id:'empty',label:'暂无量产火种',disabled:true}])],
          anchor:h('button',{type:'button',className:'sf-quantity-chip','aria-haspopup':'menu','aria-expanded':open,
            disabled:busy,onClick:()=>{ if(open) setOpen(false); else void run(async()=>{
              setItems(await call('quantityList',{})); setOpen(true);
            }); }},chosen ? '火种 · ' + chosen : '火种',h(IconChevronDownOutlineRegular,{width:14,height:14}))}),
        selected && h(Modal,{open:true,title:selected.name,closeLabel:'取消',onClose:()=>{if(!busy)setSelected(null);}},
          titleField(title, setTitle),
          selected.matrix && field('本会话使命',h('input',{value:role,maxLength:300,onChange:e=>setRole(e.target.value)}),roleHint),
          h(Button,{disabled:busy,
            onClick:()=>launch(selected,role.trim(),title.trim())},'使用此火种'),
          error && h('p',{role:'alert'},error)),
        !selected && error && h('span',{role:'alert',className:'sf-error'},error));
    }

    function QuantitySeat({sessionId, useWorkspaces, createAccess, ...props}) {
      const workspace = useWorkspaces(s => s.items.find(w => w.sessionIds.includes(sessionId))?.workspaceId);
      return workspace ? h(QuantityMenu,{...props, key:sessionId + workspace, sessionId, workspaceId:workspace, access:createAccess(workspace)}) : null;
    }

    function SaveSessionSpark({sessionId,call}) {
      const [dialog,setDialog] = React.useState(null), [busy,setBusy] = React.useState(false);
      const [error,setError] = React.useState(''), [status,setStatus] = React.useState('');
      const lock = React.useRef(false);
      const run = async work => {
        if(lock.current) return;
        lock.current=true; setBusy(true); setError(''); setStatus('');
        try { await work(); } catch(cause) { setError(cause.message); }
        finally { lock.current=false; setBusy(false); }
      };
      const begin = () => run(async()=>{
        const {sources}=await call('catalog',{workspaceId:null});
        const targets=sources.filter(s=>!s.readOnly);
        if(!targets.length) throw Error('请先在锻造台创建可编辑的火种源。');
        setDialog({targets,target:targets[0].source.id,name:'',id:'copy-'+crypto.randomUUID()});
      });
      const save = () => run(async()=>{
        const entry=dialog.targets.find(s=>s.source.id===dialog.target);
        await call('saveSessionSpark',{input:{sessionId,sourceText:JSON.stringify(entry.source),id:dialog.id,name:dialog.name.trim()}});
        setStatus('火种已保存到「'+entry.source.name+'」。'); setDialog(null);
      });
      return h(React.Fragment,null,h(Button,{onClick:begin,disabled:busy},'从当前会话另存火种…'),
        status && h('p',{role:'status'},status),!dialog && error && h('p',{role:'alert'},error),
        dialog && h(Modal,{open:true,title:'从当前会话另存火种',closeLabel:'取消',onClose:()=>{if(!busy)setDialog(null);}},
          field('目标火种源',choices(dialog.target,value=>setDialog({...dialog,target:value}),dialog.targets.map(s=>[s.source.id,s.source.name]),'目标火种源')),
          field('新火种名称',h('input',{value:dialog.name,maxLength:120,onChange:e=>setDialog({...dialog,name:e.target.value})})),
          h('p',null,'保存当前 soul、模型和会话的锻造配置。新会话从空白对话开始，用量重新计数。'),
          error && h('p',{role:'alert'},error),
          h(Button,{disabled:busy||!dialog.name.trim(),onClick:save},'保存火种')));
    }

    function WorkspaceForgeAction({ workspaceId, canCreate, openWorkbench }) {
      const allowed = React.useSyncExternalStore(canCreate.subscribe, canCreate.getSnapshot);
      return allowed
        ? h(Button, { onClick: () => openWorkbench(workspaceId) }, '在此工作区锻造新会话')
        : h('p', null, '当前没有在此工作区创建会话的权限。');
    }

    function OrdinaryForging({ sessionId, useWorkspaces, createAccess, openWorkbench }) {
      const workspaceId = useWorkspaces(state =>
        state.items.find(item => item.sessionIds.includes(sessionId))?.workspaceId);
      const phase = useWorkspaces(state => state.phase);
      return h(React.Fragment, null,
        h('h2', null, '当前是普通会话'),
        workspaceId
          ? h(WorkspaceForgeAction, { workspaceId, canCreate: createAccess(workspaceId), openWorkbench })
          : h('p', null, phase === 'ready' ? '当前会话没有可用的工作区。' : '正在读取工作区…')
      );
    }

    function ForgingView({ sessionId, readCreation, subscribeReset, call, ...workspaceProps }) {
      const [record, setRecord] = React.useState(undefined);
      const [error, setError] = React.useState('');
      const [revision, refresh] = useConnectionRevision(subscribeReset);
      React.useEffect(() => {
        const control = new AbortController();
        setRecord(undefined);
        setError('');
        readCreation(sessionId, control.signal)
          .then((value) => {
            if (control.signal.aborted) return;
            if (value !== null && value?.sessionId !== sessionId)
              throw Error('读取到的锻造记录与当前会话不匹配。');
            setRecord(value);
          })
          .catch((cause) => {
            if (!control.signal.aborted) setError(cause.message);
          });
        return () => control.abort();
      }, [sessionId, readCreation, revision]);
      let content;
      if (error) {
        content = h('div', { role: 'alert' }, h('p', null, error), h(Button, { onClick: refresh }, '重试'));
      } else if (record === undefined) {
        content = h('p', { role: 'status' }, '正在读取会话配置…');
      } else if (record === null) {
        content = h(OrdinaryForging, { sessionId, ...workspaceProps });
      } else {
        content = h(React.Fragment, null,
          h(SaveSessionSpark, {key: sessionId, sessionId, call}),
          h(Collaboration, { sessionId, call, watchRoster:workspaceProps.watchRoster, useWorkspaces:workspaceProps.useWorkspaces }),
          h('section', null, h('h3', null, '指令 · Persona'), h('pre', null, record.creation.persona || '（空）')),
          h('section', null, h('h3', null, '档案 · soul'), h('pre', null, record.creation.soul || '（空）')),
          h('p', { className: 'session-forging-note' },
            '以上为创建时的记录。修改当前 soul 文件后，可在 dsh-context 选择对应步骤，展开「注入内容 → runtime-context → 原文」，查找 Session-local soul。Persona 可在系统提示词中查看。'),
          h('code', { className: 'session-forging-path' }, record.soulPath)
        );
      }
      return h('section', { className: 'session-forging-view', 'aria-label': '锻造' }, content);
    }
    function SparkFlameIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round', 'aria-hidden': true,
      }, h('path', { d: 'M12 2c1 4-3.5 6-3 10-1.6-.8-2.4-2.2-2.5-4.1C4.2 10.5 3 13.1 3 15a9 8 0 0 0 18 0c0-4.5-3.9-9-9-13Z' }));
    }
    function ForkTurn({ sessionId, seq, resolveSeq, useProjection, forkTurn, openSession, inline }) {
      const preset = useProjection('agentPreset');
      const [busy, setBusy] = React.useState(false),
        [error, setError] = React.useState('');
      const attempt = React.useRef(null),
        running = React.useRef(false);
      if (!sessionId.startsWith('forged-') || !isForgingPreset(preset)) return null;
      const fork = async () => {
        if (running.current) return;
        running.current = true;
        setBusy(true);
        setError('');
        try {
          const atSeq = resolveSeq ? resolveSeq() : seq;
          if (!Number.isSafeInteger(atSeq)) throw Error('找不到该回复所属的已结束轮次，请重新打开会话。');
          if (attempt.current?.sessionId !== sessionId || attempt.current?.atSeq !== atSeq)
            attempt.current = { requestId: crypto.randomUUID(), sessionId, atSeq };
          const result = await forkTurn(attempt.current);
          await openSession(result.sessionId);
          attempt.current = null;
        } catch (cause) {
          setError(cause.message);
        } finally {
          running.current = false;
          setBusy(false);
        }
      };
      const action = { type: 'button', onClick: fork, disabled: busy, 'aria-label': '锻造分支' };
      return h(
        'div',
        { className: 'session-forging-branch', 'data-forging-anchor': seq },
        h(Tooltip, { label: '从这一轮末尾创建锻造分支', side: 'bottom' },
          inline
            ? h('button', { ...action, className: 'sf-branch-action' }, h(SparkFlameIcon))
            : h(Button, { ...action, size: 'sm', variant: 'toolbar' }, '锻造分支')),
        error ? h('p', { role: 'alert' }, error) : null
      );
    }
    function AssistantFork(props) {
      const timeline = props.useChat(snapshot => snapshot.timeline);
      // Resolve only the clicked message, using the same closed turn as DSH's native branch action.
      const resolveSeq = () => {
        for (const turn of timeline.turns.values()) {
          const tail = turn.data.get('turn-tail');
          if (tail?.closing?.finalNode.messageId === props.messageId) return tail.seq;
        }
      };
      return h(ForkTurn, { ...props, resolveSeq, inline: true });
    }

    function TailFork(props) {
      const tail = props.turn.data.get('turn-tail');
      if (!tail || tail.closing?.finalNode.messageId) return null;
      return h(ForkTurn, { ...props, seq: tail.seq });
    }

    return {
      inject: ['slots', 'connection', 'sessions', 'conversation', 'uiWorkspace', 'workspaces', 'layout', 'contextMenus', 'remoteAccess'],
      apply(ctx) {
        const call = async (method, args, signal) => {
          const result = await ctx.connection.rpc.call(
            '/api',
            'sessionForging/' + method,
            { args },
            signal
          );
          if (!result.ok) throw Error(result.error.message);
          return result.value;
        };
        let requestedWorkspace;
        const workspaceTarget = {
          selected:'', listeners: new Set(),
          take() {
            const id = requestedWorkspace;
            requestedWorkspace = undefined;
            return id;
          },
        };
        let active, snapshot;
        const listeners = new Set();
        const selection = { getSnapshot:() => snapshot, subscribe:fn => { listeners.add(fn); return () => listeners.delete(fn); } };
        const publish = value => { active = value; snapshot = value && {sessionId:value.sessionId, name:value.name}; for (const notify of listeners) notify(); };
        const clearDraft = () => active?.clear();
        const stage = async (workspaceId, origin, name, method, input, cog) => {
          if (origin && active?.sessionId === origin) { active.choose(name, method, input, cog); return; }
          clearDraft();
          let afterOpen, discard;
          const bind = sessionId => {
            const binding = ctx.sessions.binding(sessionId);
            if (!binding) throw Error('请重新打开工作区的新会话。');
            const shell = ctx.conversation.input.for(binding.ctx);
            const retained = ctx.sessions.retainInfo(sessionId);
            const panel = ctx.layout.panelInfo;
            const models = ctx.get('modelDirectories')?.directoryFor(sessionId);
            const cleanups = [];
            let ready = false, sending = false, accepted = false, lastSubmission;
            let selectionRevision = 0, modelReady = Promise.resolve();
            const applyCog = choice => {
              const revision = ++selectionRevision;
              modelReady = modelReady.then(() => applySparkModel(models, choice, () => active === draft && revision === selectionRevision))
                .catch(() => { /* An unavailable catalog leaves the user's current model selected. */ });
            };
            const clear = () => {
              if (active !== draft) return;
              publish(undefined);
              if (ready) {
                shell.setDraft('');
                for (const id of shell.state.getSnapshot().attachmentIds) {
                  if (shell.removeAttachment(id)) ctx.conversation.releaseDraftAttachment(id);
                }
              }
              for (const dispose of cleanups.splice(0)) dispose();
            };
            const draft = {sessionId, name, clear, choose(nextName, nextMethod, nextInput, nextCog) {
              if (sending || accepted) throw Error('正在发送首条消息。');
              method = nextMethod; input = nextInput; lastSubmission = undefined;
              draft.name = nextName; publish(draft);
              applyCog(nextCog);
            }};
            const initialize = () => {
              if (active !== draft || ready) return;
              const initial = shell.state.getSnapshot();
              const claim = {name:'锻造', token:'/锻造 ', hint:'发送消息以开始锻造会话', attachments:true,
                submit:async (text, _scope, attachments) => {
                  if (active !== draft || sending || accepted) return {kind:'error', text:'请重新选择火种。'};
                  if (!text.trim() && !attachments.length) return {kind:'error', text:'请填写消息或添加附件。'};
                  sending = true;
                  try {
                    await modelReady;
                    if (active !== draft) return {kind:'error', text:'本次锻造已取消。'};
                    if (models?.store.getSnapshot().pending) return {kind:'error', text:'模型正在切换，请稍后发送。'};
                    const key = JSON.stringify([text, attachments]);
                    if (lastSubmission?.key !== key) lastSubmission = {key, requestId:crypto.randomUUID()};
                    const result = await call(method, {input:{...input, requestId:lastSubmission.requestId, firstMessage:text, composerSessionId:sessionId,
                      ...(attachments.length ? {attachments, origin:sessionId} : {})}});
                    accepted = true;
                    if (active === draft) {
                      // Let the native command transaction settle before releasing its input.
                      setTimeout(() => { if (active === draft) { clear(); ctx.uiWorkspace.openSession(result.sessionId); } }, 0);
                    }
                    return {kind:'success'};
                  } catch (error) { return {kind:'error', text:error.message}; }
                  finally { sending = false; }
                }};
              if (!shell.beginCommand(claim, {start:0,end:0,draftRev:initial.draftRev})) {
                clear(); shell.notify('error','输入框正在提交，请稍后再选择火种。'); return;
              }
              ready = true;
              // Replacing all the editor text can remove the command chip. The fire
              // selection remains active until the user cancels or leaves the page.
              cleanups.push(shell.state.subscribe(() => {
                if (shell.state.getSnapshot().phase !== 'plain') return;
                queueMicrotask(() => {
                  const current = shell.state.getSnapshot();
                  if (active === draft && !sending && !accepted && current.phase === 'plain')
                    shell.beginCommand(claim, {start:0,end:0,draftRev:current.draftRev});
                });
              }));
              shell.focus();
            };
            discard = clear;
            publish(draft);
            // The ordinary editor may have saved text before the user picked a
            // Spark. Clear that store through DSH's shared Slot actions while
            // retaining the live editor document (including references and files).
            const store = ctx.slots.entries('conversation.session').find(entry => entry.store?.spec?.actions?.setDraft)?.store;
            if (store) cleanups.push(ctx.slots.register({name:'conversation.hero.options',
              id:'session-forging.clear-ordinary-draft', store, inject:()=>({target:sessionId})}, ForgetOrdinaryDraft));
            cleanups.push(ctx.slots.register({name:'main.conversation', priority:-50,
              inject:()=>({initialize})},NativeForgePage));
            // DSH normally carries a blank session's composer to the next workspace.
            // End this selection before the native picker performs that transfer.
            cleanups.push(ctx.slots.register({name:'conversation.hero.workspace', priority:-50,
              inject:()=>({leaveWorkspace:clear})}, ForgeWorkspacePicker));
            const leave = () => {
              if (!retained.getSnapshot().retainedBy.mainView || panel.getSnapshot().activePanelId !== null) clear();
            };
            afterOpen = () => {
              if (active !== draft) return;
              applyCog(cog);
              cleanups.push(retained.subscribe(leave), panel.subscribe(leave));
              window.addEventListener('pagehide', clear);
              cleanups.push(() => window.removeEventListener('pagehide',clear));
              leave();
            };
          };
          try {
            if (origin) bind(origin);
            else await ctx.uiWorkspace.openWorkspace(workspaceId, bind);
            afterOpen?.();
          } catch (error) {
            discard?.();
            throw error;
          }
        };
        ctx.effect(() => () => clearDraft());
        const createAccess = id => ctx.remoteAccess.source('workspace', id, 'session/create');
        const openWorkbench = workspaceId => {
          if (!createAccess(workspaceId).getSnapshot()) return;
          workspaceTarget.selected = workspaceId;
          requestedWorkspace = workspaceId;
          ctx.layout.selectPanel('session-forging');
          for (const listener of workspaceTarget.listeners) listener();
        };
        ctx.effect(() => ctx.contextMenus.register({
          id: 'session-forging.open-workspace',
          target: 'workspace',
          order: 80,
          observe: ({ workspaceId }) => [createAccess(workspaceId)],
          resolve: ({ workspaceId }) => {
            if (!createAccess(workspaceId).getSnapshot()) return [];
            return [{
              id: 'forge',
              label: '在此工作区锻造会话…',
              run: () => openWorkbench(workspaceId),
            }];
          },
        }));
        const readCreation = (sessionId, signal) => call('view', { sessionId }, signal);
        const readNotice = (sessionId, after, signal) =>
          call('forkNotice', { sessionId, after }, signal);
        const resets = new Set();
        ctx.on('connection/reset', () => {
          clearDraft?.();
          for (const reset of resets) reset();
        });
        const subscribeReset = (reset) => {
          resets.add(reset);
          return () => resets.delete(reset);
        };
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent =
            '.sf-native-conversation{display:flex;flex:1;min-width:0;min-height:0;height:100%;flex-direction:column;position:relative;isolation:isolate}.sf-native-conversation [data-conversation-scroll]{justify-content:center;overflow-y:auto}.sf-workbench{height:100%;overflow:auto;padding:32px max(24px,calc((100% - 1000px)/2));box-sizing:border-box}.sf-config-fields{border:0;min-width:0;margin:0;padding:0}.sf-workbench h1{font-size:24px;margin:0 0 24px}.sf-tabs,.sf-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}.sf-section{border-top:1px solid color-mix(in srgb,currentColor 14%,transparent);padding:24px 0}.sf-section h2{font-size:18px;margin:0 0 20px}.sf-section h3{font-size:15px;margin:20px 0 12px}.sf-field{display:flex;flex-direction:column;gap:8px;margin:12px 0;flex:1;min-width:180px}.sf-field input:not([type=checkbox]),.sf-field textarea,.sf-field select,.sf-section>select{font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:8px;padding:10px;width:100%;box-sizing:border-box}.sf-field textarea{resize:vertical}.sf-field small,.sf-muted,.sf-check small,.sf-sparks small,.sf-capabilities small{display:block;font-size:12px;opacity:.65;line-height:1.5}.sf-row,.sf-capabilities{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 20px}.sf-capabilities{max-height:360px;overflow:auto}.sf-check{display:flex;align-items:start;gap:8px;margin:8px 0}.sf-check input{margin-top:4px}.sf-sparks{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.sf-sparks button{font:inherit;color:inherit;text-align:left;background:transparent;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:10px;padding:16px;cursor:pointer}.sf-sparks button[aria-pressed=true]{border-color:currentColor;background:color-mix(in srgb,currentColor 5%,transparent)}.sf-error{color:#bd3b32}.sf-section pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto}.sf-collaboration .sf-section{padding:20px 0}.sf-collaboration ul{padding-left:20px}.sf-collaboration button{cursor:pointer}.sf-quantity-chip{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer}.sf-quantity-chip:hover,.sf-quantity-chip[aria-expanded=true]{background:var(--dsw-alias-fill-secondary)}.sf-menu-source{display:block;opacity:.65}.sf-workbench details{margin:14px 0} .session-forging-view{box-sizing:border-box;width:100%;max-width:840px;min-width:0;margin:0 auto;padding:20px clamp(16px,4%,40px)}.session-forging-view section{margin:0 0 24px}.session-forging-view h3{margin:0 0 12px;font-size:14px}.session-forging-view pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.65}.session-forging-note{font-size:12px;opacity:.65}.session-forging-path{display:block;font-size:11px;overflow-wrap:anywhere;opacity:.65}';
          style.textContent += `
            .sf-branch-action {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              vertical-align: middle;
              width: calc(28px + var(--dsh-content-font-delta, 0px));
              height: calc(28px + var(--dsh-content-font-delta, 0px));
              padding: 6px;
              border: none;
              border-radius: var(--dsw-radius-sm);
              background: transparent;
              color: var(--dsw-alias-label-tertiary);
              cursor: pointer;
            }
            .sf-branch-action svg {
              width: calc(17px + var(--dsh-content-font-delta, 0px));
              height: calc(17px + var(--dsh-content-font-delta, 0px));
            }
            @media (hover: hover) {
              .sf-branch-action:hover:not(:disabled) {
                background: var(--dsw-alias-interactive-bg-hover);
                color: var(--dsw-alias-label-secondary);
              }
            }
            .sf-branch-action:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
            .sf-branch-action:disabled { opacity: 0.4; cursor: default; }
          `;
          document.head.append(style);
          return () => style.remove();
        });
        ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
          name:'conversation.hero.options', id:'session-forging.quantity', order:30,
          inject:()=>({ call, stage, cancel:clearDraft, createAccess, hooks:{workspaces:ctx.workspaces.list,selection} }),
        }, QuantitySeat));
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'session-forging',
              inject: () => ({ call, workspaceTarget, stage, openSession: (id) => ctx.uiWorkspace.openSession(id) }),
            },
            Workbench
          )
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'session-forging', order: 25, label: '锻造台' },
            SparkFlameIcon
          )
        );
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register({
            name: 'conversation.view', id: 'session-forging', order: 30, label: '锻造',
            inject: () => ({
              call, readCreation, subscribeReset, createAccess, openWorkbench,
              watchRoster: callback => {
                const a = ctx.workspaces.list.subscribe(callback), b = ctx.sessions.list.subscribe(callback);
                const control = new AbortController();
                let cursor = null, retry;
                // Plugin roster changes do not emit native workspace/session events.
                const watch = async () => {
                  while (!control.signal.aborted) {
                    try {
                      const next = await call('rallyRemovalRevision', {after:cursor}, control.signal);
                      if (next === null || control.signal.aborted) return;
                      if (next !== cursor) callback();
                      cursor = next;
                    } catch {
                      if (!control.signal.aborted) retry = setTimeout(watch, 1500);
                      return;
                    }
                  }
                };
                void watch();
                return () => { control.abort(); clearTimeout(retry); a(); b(); };
              },
              hooks: { workspaces: ctx.workspaces.list },
            }),
          }, props => h(ForgingView, { ...props, key: props.sessionId }))
        );
        // Notices also arrive while the user is on the native chat tab.
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register({
            name: 'conversation.session.header.utilities', id: 'session-forging.notice',
            inject: () => ({ readNotice, subscribeReset }),
          }, props => h(ForgingNotice, { ...props, key: props.sessionId }))
        );
        for (const [name, component] of [
          ['conversation.chat.assistant-actions', AssistantFork],
          ['conversation.chat.turnTail', TailFork],
        ]) {
          ctx.slots.inject(name, () => ctx.slots.register({
            name, id: 'session-forging.branch', order: 50,
            inject: () => ({
              forkTurn: input => call('forkTurn', { input }),
              openSession: id => ctx.uiWorkspace.openSession(id),
            }),
          }, component));
        }
      },
    };
  },
});
