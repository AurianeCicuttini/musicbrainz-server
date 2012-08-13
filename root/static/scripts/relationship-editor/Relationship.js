/*
   This file is part of MusicBrainz, the open internet music database.
   Copyright (C) 2012 MetaBrainz Foundation

   This program is free software; you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 2 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program; if not, write to the Free Software
   Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
*/

MB.RelationshipEditor = (function(RE) {

var UI = RE.UI = RE.UI || {}, Util = RE.Util = RE.Util || {},
    Fields = RE.Fields = RE.Fields || {}, mapping, cache = {};

mapping = {
    // entities (source, target) have their own mapping options in Entity.js
    ignore:  ["source", "target", "visible", "ended"],
    copy:    ["edits_pending", "id"],
    include: ["link_type", "action", "backward", "begin_date", "end_date", "attributes"],
    attributes: {
        update: function(options) {return $.extend(true, {}, options.data)}
    },
    begin_date: {
        update: function(options) {
            return new Fields.PartialDate(options.data);
        }
    }
};

mapping.end_date = mapping.begin_date;


RE.Relationship = function(obj, tryToMerge) {
    obj.link_type = obj.link_type || Util.defaultLinkType(obj.source.type, obj.target.type);
    var type = Util.type(obj.link_type), relationship, _cache;

    if ((_cache = cache[type]) === undefined) _cache = cache[type] = {};
    if (obj.id === undefined) obj.id = _.uniqueId("new-");

    if ((relationship = _cache[obj.id]) === undefined)
        relationship = _cache[obj.id] = new Relationship(obj);

    if (tryToMerge && relationship.source.mergeRelationship(relationship)) {
        delete _cache[obj.id];
        return null;
    }
    return relationship;
};


var Relationship = function(obj) {
    var self = this;

    this.exists = false; // new relationships still being edited don't exist

    this.id = obj.id;
    this.changeCount = 0;
    this.errorCount = 0;
    this.action = ko.observable(obj.action || "");
    this.hasErrors = ko.observable(false);

    this.link_type = new Fields.Integer(obj.link_type).extend({field: [this, "link_type"]});
    this.begin_date = new Fields.PartialDate();
    this.end_date = new Fields.PartialDate();
    this.backward = ko.observable(false);
    this.type = new Fields.Type(this);
    this.attributes = new Fields.Attributes(this);

    this.dateRendering = ko.computed({read: this.renderDate, owner: this})
        .extend({throttle: 100});

    // entities have a refcount so that they can be deleted when they aren't
    // referenced by any relationship. we use a computed observable for the target,
    // so that we don't have to remember to decrement the refcount each time the
    // target changes.

    obj.source.refcount += 1;
    this.source = obj.source; // source can't change

    if (this.type.peek() == "recording-work")
        obj.target.performanceRefcount += 1;

    obj.target.refcount += 1;
    this.target = new Fields.Target(obj.target, this);
    // XXX trigger the validation subscription's callback, so that validation
    // on the target's name is registered as well.
    this.target.notifySubscribers(this.target.peek());

    ko.mapping.fromJS(obj, mapping, this);

    // add these *after* pulling in the obj mapping, otherwise they'll mark the
    // relationship as having changes.
    this.begin_date.extend({field: [this, "begin_date"]});
    this.end_date.extend({field: [this, "end_date"]});
    this.backward.extend({field: [this, "backward"]});
    this.attributes.extend({field: [this, "attributes"]});

    this.entity = ko.computed(computeEntities, this);
    this.linkPhrase = ko.computed(this.buildLinkPhrase, this).extend({throttle: 1});
    this.loadingWork = ko.observable(false);

    this.edits_pending
        ? (this.openEdits = ko.computed(this.buildOpenEdits, this))
        : (this.edits_pending = false);

    delete obj;
};


var computeEntities = function() {
    var src = Util.src(this.link_type(), this.backward());
    return src == 0 ? [this.source, this.target()] : [this.target(), this.source];
};


Relationship.prototype.changeTarget = function(oldTarget, newTarget, observable) {
    var type = this.type.peek();

    observable(newTarget);
    newTarget.refcount += 1;

    if (oldTarget) {
        oldTarget.remove();

        if (type == "recording-work") oldTarget.performanceRefcount -= 1;

        if  (oldTarget.type != newTarget.type) {
            // the type changed. our relationship cache is organized by type, so we
            // have to move the position of this relationship in the cache.
            var oldType = Util.type(this.link_type.peek()), newType;

            this.link_type(Util.defaultLinkType(this.source.type, newTarget.type));
            newType = Util.type(this.link_type.peek());

            (cache[newType] = cache[newType] || {})[this.id] = cache[oldType][this.id];
            delete cache[oldType][this.id];

            // fix the direction.
            var typeInfo = RE.typeInfo[this.link_type.peek()];
            this.backward(this.source.type != typeInfo.types[0]);
        }
    }

    if (type == "recording-work") {
        newTarget.performanceRefcount += 1;
        this.workChanged(newTarget);
    }
};

// if the user changed a work, we need to request its relationships.

var worksLoading = {};

Relationship.prototype.workChanged = function(work) {
    var gid = work.gid, self = this;
    if (worksLoading[gid]) return;

    this.loadingWork(true);
    worksLoading[gid] = 1;

    $.get("/ws/js/entity/" + gid + "?inc=rels")
        .success(function(data) {
            Util.parseRelationships(data, false);
        })
        .complete(function() {
            self.loadingWork(false);
            delete worksLoading[gid];
        });
};


Relationship.prototype.show = function() {
    var source = this.source;

    if (this.type.peek() == "recording-work") {
        if (source.performanceRelationships.peek().indexOf(this) == -1)
            source.performanceRelationships.push(this);

    } else if (source.relationships.peek().indexOf(this) == -1) {
        source.relationships.push(this);
    }
    this.exists = true;
};


Relationship.prototype.reset = function(obj) {
    this.hasErrors(false);
    this.errorCount = 0;
    var fields = Util.originalFields(this);

    if (fields) {
        ko.mapping.fromJS(fields, this);
        this.target(fields.target);
        this.changeCount = 0;
    }
};


Relationship.prototype.remove = function() {
    // prevent this from being removed twice, otherwise it screws up refcounts
    // everywhere. this can happen if the relationship is merged into another
    // one (thus removed), and then removed again when the dialog is closed
    // (because the dialog sees that this.exists is false).
    if (this.removed === true) return;

    var recordingWork = (this.type() == "recording-work"),
        target = this.target.peek();

    if (recordingWork) {
        this.source.performanceRelationships.remove(this);
        target.performanceRefcount -= 1;
    } else {
        this.source.relationships.remove(this);
    }

    this.source.remove();
    target.remove();

    if (recordingWork && target.performanceRefcount <= 0) {
        var relationships = target.relationships.slice(0);

        for (var i = 0; i < relationships.length; i++)
            relationships[i].remove();
    }
    delete cache[this.type.peek()][this.id];
    this.exists = false;
    this.removed = true;
};

// Constructs the link phrase to display for this relationship

Relationship.prototype.buildLinkPhrase = function() {
    var typeInfo = RE.typeInfo[this.link_type()];
    if (!typeInfo) return "";

    var attrs = {}, m, phrase = this.source === this.entity()[0]
        ? typeInfo.link_phrase : typeInfo.reverse_link_phrase;

    $.each(this.attributes(), function(name, observable) {
        var value = observable(), str = name, isArray = $.isArray(value);

        if (!value || isArray && !value.length) return;
        if (isArray) {
            value = $.map(value, function(v) {return RE.attrMap[v].name});

            var list = value.slice(0, -1).join(", ");
            str = (list && list + " & ") + (value.pop() || "");
        }
        attrs[name] = str;
    });
    while (m = phrase.match(/\{(.*?)(?::(.*?))?\}/)) {
        var replace = attrs[m[1]] !== undefined
            ? (m[2] && m[2].split("|")[0]) || attrs[m[1]]
            : (m[2] && m[2].split("|")[1]) || "";
        phrase = phrase.replace(m[0], replace);
    }
    return _.clean(phrase);
};


function renderDate(date) {
    var year = date.year(), month = date.month(), day = date.day();
    return year ? year + (month ? "-" + month + (day ? "-" + day : "") : "") : "";
}

Relationship.prototype.renderDate = function() {
    var begin_date = renderDate(this.begin_date.peek()),
        end_date = renderDate(this.end_date.peek());

    if (!begin_date && !end_date) return "";
    if (begin_date == end_date) return MB.text.Date.on + " " + begin_date;

    return (begin_date ? MB.text.Date.from + " " + begin_date + " \u2013" : MB.text.Date.until) + " " +
           (end_date || "????");
};

// Contruction of form fields

var simpleFields = ["id", "link_type", "action"], dateFields = ["year", "month", "day"],
    entityFields = ["gid", "type"];

var buildField = function(prefix, name, obj, fields) {
    var field, value, prefix = prefix + (name && name + ".");

    for (var i = 0; field = fields[i]; i++) {
        value = ko.utils.unwrapObservable(obj[field]);
        if (value) {
            field = prefix + field;

            if (_.isArray(value)) {
                for (var j = 0; j < value.length; j++)
                    this[field + "." + j] = value[j];
            } else {
                if (_.isBoolean(value)) value = value ? 1 : 0;
                this[field] = value;
            }
        }
    }
};

Relationship.prototype.buildFields = function(num, result) {
    var attrs = _.keys(this.attributes.peek()), entity = this.entity.peek(),
        prefix = "rel-editor.rels." + num + ".", bf = _.bind(buildField, result),
        sf = (this.action.peek() == "add") ? _.rest(simpleFields) : simpleFields;

    bf(prefix, "", this, sf);
    bf(prefix, "begin_date", this.begin_date.peek(), dateFields);
    bf(prefix, "end_date", this.end_date.peek(), dateFields);
    bf(prefix, "attrs", this.attributes.peek(), attrs);
    bf(prefix, "entity.0", entity[0], entityFields);
    bf(prefix, "entity.1", entity[1], entityFields);
};

// returns true if this relationship is a "duplicate" of the other.
// doesn't compare attributes

Relationship.prototype.isDuplicate = function(other) {
    var thisent = this.entity.peek(), otherent = other.entity.peek();
    return (this.link_type.peek() == other.link_type.peek() &&
            thisent[0] === otherent[0] && thisent[1] === otherent[1]);
};


Relationship.prototype.buildOpenEdits = function() {
    var orig = Util.originalFields(this), source = this.source, target = orig.target;

    return _.sprintf(
        '/search/edits?auto_edit_filter=&order=desc&negation=0&combinator=and' +
        '&conditions.0.field=%s&conditions.0.operator=%%3D&conditions.0.name=%s' +
        '&conditions.0.args.0=%s&conditions.1.field=%s&conditions.1.operator=%%3D' +
        '&conditions.1.name=%s&conditions.1.args.0=%s&conditions.2.field=type' +
        '&conditions.2.operator=%%3D&conditions.2.args=90%%2C233&conditions.2.args=91' +
        '&conditions.2.args=92&conditions.3.field=status&conditions.3.operator=%%3D' +
        '&conditions.3.args=1&field=Please+choose+a+condition',
        encodeURIComponent(source.type),
        encodeURIComponent(source.name()),
        encodeURIComponent(source.id),
        encodeURIComponent(target.type),
        encodeURIComponent(target.name()),
        encodeURIComponent(target.id)
    );
};

return RE;

}(MB.RelationshipEditor || {}));
