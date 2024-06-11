const loader = {
  load(path, cb) {
    fetch(loader.getURL(path)).then(res => res.json())
      .then(data => {
        const { uri } = data.buffers[0];
        fetch(loader.getURL(path, uri)).then(res => res.arrayBuffer())
          .then(buffer => {
            data.buffers[0] = buffer;
            cb && cb(data);
          });
      });
  },
  
  getURL(path, file = loader.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

class NodeTree {
  constructor(parent, children, nodes) {
    this.parent = parent;
    this.children = children;
    this.nodes = nodes;
  }

  static from({ scene, scenes, nodes }) {
    return new NodeTree(null, scenes[scene].nodes, nodes);
  }

  traverse(cb) {
    for (const child of this.children) {
      const { children, ...rest } = this.nodes[child];
      cb && cb(rest, this.parent);

      if (children) {
        const tree = new NodeTree(rest, children, this.nodes);
        tree.traverse(cb);
      }
    }
  }
}

class Mesh {
  constructor(primitives) {
    this.primitives = primitives;
  }

  getData(bufferProvider) {
    return this.primitives.map( ({ attrs, indicesInfo }) => ({
      vbo: bufferProvider.getBuffer(attrs['POSITION']),
      nbo: bufferProvider.getBuffer(attrs['NORMAL']),
      tbo: bufferProvider.getBuffer(attrs['TEXCOORD_0']),
      ibo: bufferProvider.getBuffer(indicesInfo),
    }) );
  }
}

class MeshProvider {
  constructor({ accessors, bufferViews, buffers }) {
    this.accessors = accessors;
    this.bufferViews = bufferViews;
    this.buffers = buffers; 
  }

  getMesh({ primitives }) {
    const _primitives = primitives.map( prim => ({
      attrs: Object.entries(prim.attributes)
        .reduce((attr, [key, value]) => {
          attr[key] = this._getAccessor(this.accessors[value]);
          return attr;
        }, {}),

      indicesInfo: this._getAccessor(this.accessors[prim.indices]),
    }) );

    return new Mesh(_primitives);
  }

  _getAccessor({ bufferView: bv, ...rest }) {
    const bufferView = this._getBufferView(this.bufferViews[bv]);
    return { ...rest, bufferView };
  }

  _getBufferView({ buffer, byteOffset, byteLength, target }) {
    const data = new Uint8Array(this.buffers[buffer], 
      byteOffset, byteLength);

    return { target, data };
  }
}

class Node {
  constructor(name, parent, trs, mesh) {
    this.name = name;
    this.parent = parent;
    this.trs = trs;
    this.mesh = mesh;
  }

  getMatrix(m4) {
    const matrix = this.trs.calcMatrix(m4);
    if (this.parent) {
      const pMatrix = this.parent.getMatrix(m4);
      m4.mul(matrix, pMatrix, matrix);
    }

    return matrix;
  }
}

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

function getScene({ meshes, ...rest }) {
  const nodeTree = NodeTree.from(rest);
  const meshProvider = new MeshProvider(rest);
  const scene = new Scene([]);

  nodeTree.traverse((node, parent) => {
    const _parent = parent && scene.findNode(parent.name);
    const mesh = meshProvider.getMesh(meshes[node.mesh]);
    scene.addNode(new Node(node.name, _parent, new TRS(node), mesh));
  });

  return scene;
}

loader.load('tank', data => {

  const scene = getScene(data);
  console.log(scene);

});