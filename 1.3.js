const gltf = {
  NodeTree: class {
    constructor(parent, children, nodes) {
      this.parent = parent;
      this.children = children;
      this.nodes = nodes;
    }
  
    static from({ scene, scenes, nodes }) {
      return new gltf.NodeTree(null, scenes[scene].nodes, nodes);
    }
  
    traverse(cb) {
      for (const child of this.children) {
        const { children, ...rest } = this.nodes[child];
        cb && cb(rest, this.parent);
  
        if (children) {
          new gltf.NodeTree(rest, children, this.nodes)
            .traverse(cb);
        }
      }
    }
  },

  MeshProvider: class {
    constructor({ meshes, accessors, bufferViews, buffers }) {
      this.meshes = meshes;
      this.accessors = accessors;
      this.bufferViews = bufferViews;
      this.buffers = buffers; 
    }

    getMesh(index) {
      return this._getMesh(this.meshes[index]);
    }

    _getMesh({ primitives }) {
      return primitives.map(prim => ({
        attributes: Object.entries(prim.attributes)
          .reduce((attr, [key, value]) => {
            attr[key] = this._getAccessor(value);
            return attr;
          }, {}),

        indices: this._getAccessor(prim.indices),
      }));
    }

    _getAccessor(index) {
      return this._getAccessorBy(this.accessors[index]);
    }

    _getAccessorBy({ bufferView: bv, ...rest }) {
      const bufferView = this._getBufferView(this.bufferViews[bv]);
      return { ...rest, bufferView };
    }
  
    _getBufferView({ buffer, byteOffset, byteLength, target }) {
      const data = new Uint8Array(this.buffers[buffer], 
        byteOffset, byteLength);
  
      return { target, data };
    }
  },

  load(path, cb) {
    fetch(gltf.getURL(path)).then(res => res.json())
      .then(data => {
        const { uri } = data.buffers[0];
        fetch(gltf.getURL(path, uri)).then(res => res.arrayBuffer())
          .then(buffer => {
            data.buffers[0] = buffer;
            cb && cb(data);
          });
      });
  },
  
  getURL(path, file = gltf.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

class Scene {
  constructor(nodes) {
    this.nodes = nodes;
  }

  addNode(node) {
    this.nodes.push(node);
  }

  findNode(name) {
    return this.nodes.find(node => node.name === name);
  }

  *[Symbol.iterator]() {
    for (const node of this.nodes) {
      yield node;
    }
  }
}

class Node {
  constructor(name, trs, mesh, parent) {
    this.name = name;
    this.trs = trs;
    this.mesh = mesh;
    this.parent = parent;
  }

  calcMatrix(mat4) {
    const mat = this.trs.calcMatrix(mat4);
    if (this.parent) {
      mat4.mul(mat, this.parent.calcMatrix(mat4), mat);
    }

    return mat;
  }

  getMesh(bufferProvider) {
    return this._getMesh(({ bufferView, type, componentType, count }) => ({
      buffer: bufferProvider.getBuffer(bufferView),
      componentsNum: utils.getComponentsNumOf(type),
      componentType, count,
    }));
  }

  _getMesh(fn) {
    return this.mesh.map(({ attributes, indices }) => ({
      vbo: fn(attributes['POSITION']),
      nbo: fn(attributes['NORMAL']),
      tbo: fn(attributes['TEXCOORD_0']),
      ibo: fn(indices),
    }));
  }
}

class TRS {
  constructor({ translation, rotation, scale }) {
    this.translation = translation ?? [0, 0, 0];
    this.rotation = rotation ?? [0, 0, 0, 1];
    this.scale = scale ?? [1, 1, 1];
  }

  calcMatrix(mat4) {
    const mat = mat4.create();
    mat4.fromRotationTranslationScale(mat, 
      this.rotation, this.translation, this.scale);

    return mat;
  }
}

function createScene(data) {
  return createSceneBy(gltf.NodeTree.from(data), 
    new gltf.MeshProvider(data));
}

function createSceneBy(nodeTree, meshProvider) {
  const scene = new Scene([]);

  nodeTree.traverse((node, parent) => {
    const _node = new Node(node.name, 
      new TRS(node), meshProvider.getMesh(node.mesh), 
      parent && scene.findNode(parent.name));

    scene.addNode(_node);
  });

  return scene;
}

gltf.load('tank', data => {
  const { mat4 } = glMatrix;
  const bufferProvider = { getBuffer: bv => bv };
  const scene = createScene(data);

  for (const node of scene) {
    console.log({
      matrix: node.calcMatrix(mat4),
      mesh: node.getMesh(bufferProvider),
    });
  }
});