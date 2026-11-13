// Compact control in the composer that shows "lead → subagent" and opens a
// bottom sheet (ui-sdk's Drawer) to change either model. Options always come
// from the server's `models`/`subagentModels`, never hardcoded.
import { For, Show } from 'solid-js'
import { Drawer, DrawerBackdrop, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from '@ui-sdk/solid/drawer'
import { Field, FieldLabel } from '@ui-sdk/solid/field'
import { Radio, RadioGroup, RadioIndicator } from '@ui-sdk/solid/radio'
import { shortModel } from '../fleet/format'
import type { Lead } from './useLead'
import './composer.css'

function TriggerLabel(props: { lead: Lead }) {
  const s = () => props.lead.state()
  return (
    <>
      <span>{s() ? shortModel(s()!.model) : '…'}</span>
      <span class="model-trigger-arrow" aria-hidden="true">
        →
      </span>
      <span>{s() ? shortModel(s()!.subagentModel) : '…'}</span>
    </>
  )
}

export function ModelPicker(props: { lead: Lead }) {
  const state = () => props.lead.state()
  const triggerLabel = () => {
    const s = state()
    return s ? `Models: ${shortModel(s.model)} leads, ${shortModel(s.subagentModel)} agents. Change` : 'Models'
  }

  return (
    <Drawer side="bottom">
      <DrawerTrigger class="chip model-trigger" aria-label={triggerLabel()}>
        <TriggerLabel lead={props.lead} />
      </DrawerTrigger>
      <DrawerBackdrop />
      <DrawerContent class="model-sheet" initialFocus="content">
        <div data-slot="grip" aria-hidden="true" />
        <DrawerTitle>Models</DrawerTitle>
        <DrawerDescription>Choose the model that leads, and the model it delegates to.</DrawerDescription>
        <Show when={state()}>
          {(s) => (
            <div class="model-sheet-groups">
              <Field>
                <FieldLabel>Lead model</FieldLabel>
                <RadioGroup
                  class="model-options"
                  value={s().model}
                  onValueChange={(v) => {
                    if (v) props.lead.act({ action: 'model', model: v })
                  }}
                >
                  <For each={s().models}>
                    {(m) => (
                      <label class="model-option">
                        <Radio value={m}>
                          <RadioIndicator />
                        </Radio>
                        {shortModel(m)}
                      </label>
                    )}
                  </For>
                </RadioGroup>
              </Field>
              <Field>
                <FieldLabel>Subagent model</FieldLabel>
                <RadioGroup
                  class="model-options"
                  value={s().subagentModel}
                  onValueChange={(v) => {
                    if (v) props.lead.act({ action: 'model', subagentModel: v })
                  }}
                >
                  <For each={s().subagentModels}>
                    {(m) => (
                      <label class="model-option">
                        <Radio value={m}>
                          <RadioIndicator />
                        </Radio>
                        {shortModel(m)}
                      </label>
                    )}
                  </For>
                </RadioGroup>
              </Field>
            </div>
          )}
        </Show>
      </DrawerContent>
    </Drawer>
  )
}
