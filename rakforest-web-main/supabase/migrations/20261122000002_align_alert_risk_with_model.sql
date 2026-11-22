begin;

create or replace function public.fn_calculate_risk_level(
  p_label text,
  p_confidence numeric,
  p_raw_response jsonb default '{}'::jsonb
)
returns text language plpgsql as $$
declare
  v_fire numeric := 0;
  v_chainsaw numeric := 0;
  v_tactical numeric := 0;
  v_vehicle numeric := 0;
  v_human numeric := 0;
  v_item jsonb;
begin
  -- Softmax classifies by its single winning class.
  if p_raw_response->>'modelId' = 'cnn_softmax' then
    return case
      when p_label in ('fire', 'chainsaw', 'threat_tactical', 'gunshot') then 'red'
      when p_label in ('vehicle', 'human_activity') then 'yellow'
      else 'green'
    end;
  end if;

  if p_raw_response is not null and jsonb_typeof(p_raw_response->'scores') = 'array' then
    for v_item in select * from jsonb_array_elements(p_raw_response->'scores')
    loop
      case v_item->>'classId'
        when 'fire' then v_fire := greatest(v_fire, coalesce((v_item->>'score')::numeric, 0));
        when 'chainsaw' then v_chainsaw := greatest(v_chainsaw, coalesce((v_item->>'score')::numeric, 0));
        when 'gunshot' then v_tactical := greatest(v_tactical, coalesce((v_item->>'score')::numeric, 0));
        when 'threat_tactical' then v_tactical := greatest(v_tactical, coalesce((v_item->>'score')::numeric, 0));
        when 'vehicle' then v_vehicle := greatest(v_vehicle, coalesce((v_item->>'score')::numeric, 0));
        when 'human_activity' then v_human := greatest(v_human, coalesce((v_item->>'score')::numeric, 0));
        else null;
      end case;
    end loop;
  else
    case p_label
      when 'fire' then v_fire := p_confidence;
      when 'chainsaw' then v_chainsaw := p_confidence;
      when 'threat_tactical' then v_tactical := p_confidence;
      when 'gunshot' then v_tactical := p_confidence;
      when 'vehicle' then v_vehicle := p_confidence;
      when 'human_activity' then v_human := p_confidence;
      else null;
    end case;
  end if;

  if greatest(v_fire, v_chainsaw, v_tactical) >= 0.75 then
    return 'red';
  elsif greatest(v_fire, v_chainsaw, v_tactical) >= 0.45 or greatest(v_vehicle, v_human) >= 0.60 then
    return 'yellow';
  else
    return 'green';
  end if;
end;
$$;

commit;
