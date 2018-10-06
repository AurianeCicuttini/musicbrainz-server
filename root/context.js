/*
 * @flow
 * Copyright (C) 2018 MetaBrainz Foundation
 *
 * This file is part of MusicBrainz, the open internet music database,
 * and is licensed under the GPL version 2, or (at your option) any
 * later version: http://www.gnu.org/licenses/gpl-2.0.txt
 */

import React from 'react';
import type {ComponentType} from 'react';

const defaultContext = {
  action: {
    name: '',
  },
  linked_entities: {
    artist_type: {},
    language: {},
    link_type: {},
    release_group_primary_type: {},
    release_group_secondary_type: {},
    release_packaging: {},
    release_status: {},
    script: {},
    series_ordering_type: {},
    series_type: {},
    work_attribute_type: {},
  },
  relative_uri: '',
  req: {
    headers: {},
    query_params: {},
    secure: false,
    uri: '',
  },
  session: null,
  sessionid: null,
  stash: {
    current_language: 'en',
    current_language_html: 'en',
  },
  user_exists: false,
};

export const CatalystContext = React.createContext(defaultContext);

type ContextPropT = {
  +$c: CatalystContextT | SanitizedCatalystContextT,
};

export function withCatalystContext<P: ContextPropT, T: $Diff<P, ContextPropT>>(
  Component: ComponentType<P>,
): ComponentType<T> {
  return (props: T) => (
    <CatalystContext.Consumer>
      {($c: CatalystContextT) => <Component $c={$c} {...props} />}
    </CatalystContext.Consumer>
  );
}
